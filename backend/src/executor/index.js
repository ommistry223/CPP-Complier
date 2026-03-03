'use strict';

const { execFile } = require('child_process');
const { spawn }    = require('child_process');
const fs           = require('fs').promises;
const path         = require('path');
const { v4: uuidv4 } = require('uuid');
const os           = require('os');
const crypto       = require('crypto');
const logger       = require('../utils/logger');

/* ── Language config ─────────────────────────────────────────── */
const LANGUAGES = {
  cpp: {
    extension: '.cpp',
    // -pipe: use OS pipes between compiler stages (no intermediate temp files → faster,
    //        especially on tmpfs RAM disks)
    // -O1 vs -O2: compiles ~1.5× faster; correctness judging doesn't need peak optimisation
    compileArgs: (src, out) => ['-pipe', '-O1', '-std=c++17', '-Wno-unused-result', '-o', out, src],
    compiler:   'g++',
  },
  c: {
    extension: '.c',
    compileArgs: (src, out) => ['-pipe', '-O1', '-std=c11', '-Wno-unused-result', '-o', out, src],
    compiler:   'gcc',
  },
};

/* ── Binary cache ───────────────────────────────────────────────
   Compiled binaries are stored in bin_cache/<hash>.out (at /app/bin_cache
   inside the container — regular overlay FS, always exec-capable) and
   reused across submissions with identical source code.
   Avoids the ~1-3s g++ step on every re-submission — very common
   in contests where teams iterate on the same code.
   In-memory LRU (max BIN_CACHE_MAX entries) guards the hot path.
─────────────────────────────────────────────────────────────── */
const BIN_CACHE_MAX = parseInt(process.env.BIN_CACHE_MAX) || 150;
const _binCacheMap  = new Map();   // compileHash → { execPath, lastUsed }
// bin_cache lives OUTSIDE the tmpfs mount (/app/temp) so compiled binaries
// are on the regular container overlay FS, which is always exec-capable.
// (Docker tmpfs can be mounted noexec by default, causing "Permission denied"
//  when the shell tries to execute a newly compiled binary.)
const _binCacheDir  = path.join(__dirname, '..', '..', 'bin_cache');

// Create the cache directory once on module load
fs.mkdir(_binCacheDir, { recursive: true }).catch(() => {});

async function _getBinCache(hash) {
  const entry = _binCacheMap.get(hash);
  if (!entry) return null;
  try {
    await fs.access(entry.execPath);   // file must still exist on disk
    entry.lastUsed = Date.now();
    return entry.execPath;
  } catch {
    _binCacheMap.delete(hash);         // evict stale entry
    return null;
  }
}

function _putBinCache(hash, execPath) {
  if (_binCacheMap.size >= BIN_CACHE_MAX) {
    // LRU eviction: remove the least-recently-used entry
    let oldestKey = null, oldestTime = Infinity;
    for (const [k, v] of _binCacheMap) {
      if (v.lastUsed < oldestTime) { oldestTime = v.lastUsed; oldestKey = k; }
    }
    if (oldestKey) {
      const evicted = _binCacheMap.get(oldestKey);
      _binCacheMap.delete(oldestKey);
      fs.rm(evicted.execPath, { force: true }).catch(() => {});
    }
  }
  _binCacheMap.set(hash, { execPath, lastUsed: Date.now() });
}

/* ── Compile deduplication ──────────────────────────────────────
   If N teams submit identical code concurrently, only ONE g++
   process fires. The rest await the same Promise and all get
   the cached binary instantly when compilation finishes.
─────────────────────────────────────────────────────────────── */
const _compileInflight = new Map();  // compileHash → Promise<{success, error?}>

/* ── Tuning constants ────────────────────────────────────────── */
// Run test-cases in parallel up to this many at once.
// Dynamic: 2× CPU count so we keep all cores busy but cap burst.
const MAX_CONCURRENT = Math.min(
  Math.max(parseInt(process.env.TC_CONCURRENCY) || 0, 0) || os.cpus().length * 2,
  32
);

const COMPILE_TIMEOUT_MS  = 20_000;              // 20 s max compile time
const STDERR_LIMIT_BYTES  = 64  * 1024;          // 64 KB stderr cap
const STDOUT_LIMIT_BYTES  = 8   * 1024 * 1024;   // 8 MB stdout cap

logger.info(`[Executor] MAX_CONCURRENT=${MAX_CONCURRENT} CPUs=${os.cpus().length}`);

/* ══════════════════════════════════════════════════════════════ */
class Executor {
  constructor(language, code, customTimeLimit, customMemoryLimit) {
    this.language   = LANGUAGES[language] ? language : 'cpp';
    this.code       = code;
    this.timeLimit  = customTimeLimit  || parseInt(process.env.MAX_EXECUTION_TIME) || 3000;
    // Memory limit in MB → KB for ulimit -v
    this.memLimitKB = (customMemoryLimit || parseInt(process.env.MAX_MEMORY_MB) || 256) * 1024;
    // CPU time guard: wall-clock + 3 s grace
    this.cpuTimeSec = Math.ceil(this.timeLimit / 1000) + 3;

    this.config     = LANGUAGES[this.language];
    this.runId      = uuidv4();
    this.baseDir    = path.join(__dirname, '..', '..', 'temp', this.runId);
    this.sourceFile = '';
    this.executable = '';
  }

  /* ── Prepare temp dir + write source ────────────────────────── */
  async prepare() {
    await fs.mkdir(this.baseDir, { recursive: true });
    const fileName  = `source${this.config.extension}`;
    this.sourceFile = path.join(this.baseDir, fileName);
    // executable is set by compile() via the binary cache
    this.executable = '';
    await fs.writeFile(this.sourceFile, this.code);
    logger.debug(`Prepared env ${this.runId} (${this.language.toUpperCase()})`);
  }

  /* ── Compile ───────────────────────────────────────────────────
     Three-tier fast path:
     1. Binary cache HIT  → reuse existing .out file, skip g++ entirely
     2. In-flight dedup   → identical code already compiling → share result
     3. Compile + cache   → write binary to bin_cache/ for future reuse
  ─────────────────────────────────────────────────────────────── */
  async compile() {
    // Key on language + code only — same source always produces same binary
    const compileHash = crypto
      .createHash('sha256')
      .update(`${this.language}:${this.code}`)
      .digest('hex');

    // ── Tier 1: binary cache hit ────────────────────────────────
    const cached = await _getBinCache(compileHash);
    if (cached) {
      this.executable = cached;
      logger.debug(`[exec] bin-cache HIT ${compileHash.slice(0, 8)} — skipping g++`);
      return { success: true };
    }

    // ── Tier 2: deduplicate concurrent identical compiles ───────
    if (_compileInflight.has(compileHash)) {
      logger.debug(`[exec] waiting for in-flight compile ${compileHash.slice(0, 8)}`);
      const result = await _compileInflight.get(compileHash);
      if (result.success) {
        const refreshed = await _getBinCache(compileHash);
        if (refreshed) { this.executable = refreshed; return { success: true }; }
      }
      return result;
    }

    // ── Tier 3: compile and store in binary cache ───────────────
    const cacheTarget = path.join(_binCacheDir, `${compileHash}.out`);
    const args = this.config.compileArgs(this.sourceFile, cacheTarget);

    const compilePromise = new Promise((resolve) => {
      execFile(
        this.config.compiler,
        args,
        { timeout: COMPILE_TIMEOUT_MS, maxBuffer: 512 * 1024 },
        (_error, _stdout, stderr) => {
          if (_error) {
            let msg = (stderr || _error.message || 'Compilation Error').trim();
            msg = msg.replace(/[^\s]+source\.(cpp|c):/g, 'Line ');
            if (msg.includes('command not found') || msg.includes('not recognized')) {
              msg = 'Compiler (g++/gcc) is not installed or not on PATH.';
            }
            return resolve({ success: false, error: msg });
          }
          resolve({ success: true });
        }
      );
    });

    _compileInflight.set(compileHash, compilePromise);
    try {
      const result = await compilePromise;
      if (result.success) {
        // Ensure the binary has execute permission (required on Docker/Windows mounts
        // where g++ may produce a file without the +x bit set).
        await fs.chmod(cacheTarget, 0o755).catch(() => {});
        _putBinCache(compileHash, cacheTarget);
        this.executable = cacheTarget;
        logger.debug(`[exec] compiled + cached ${compileHash.slice(0, 8)}`);
      }
      return result;
    } finally {
      _compileInflight.delete(compileHash);
    }
  }

  /* ── Run ONE test-case with full sandboxing ───────────────────
     Safety layers:
     1. ulimit -v  — cap virtual memory (kills malloc bombs)
     2. ulimit -t  — cap CPU seconds   (backup for tight inf-loops)
     3. detached=true → new process group → kill(-pid) kills all descendants
     4. settled flag — no double-resolve/double-reject race condition
     5. Buffer chunks — faster than string concat, less GC pressure
     6. Stdout/stderr hard limits — no OOM from output floods
  ──────────────────────────────────────────────────────────────── */
  _runProcessWithInput(input) {
    return new Promise((resolve, reject) => {
      let settled       = false;
      const outChunks   = [];
      const errChunks   = [];
      let outLen        = 0;
      let errLen        = 0;

      // One-shot resolve/reject — ignores all subsequent calls
      const done = (fn, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(wallClock);
        fn(val);
      };

      // Shell command with resource limits — exec replaces shell so pid tracking is clean
      const limitShell = `ulimit -v ${this.memLimitKB} -t ${this.cpuTimeSec} 2>/dev/null; exec "${this.executable}"`;
      const child = spawn('sh', ['-c', limitShell], {
        detached: true,   // own process group — kill(-pid) nukes entire subtree
        env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
      });

      /* Wall-clock TLE guard */
      const wallClock = setTimeout(() => {
        killGroup(child.pid);
        done(reject, { status: 'time_limit_exceeded', message: 'Time Limit Exceeded' });
      }, this.timeLimit);

      /* stdin — EPIPE safe */
      child.stdin.on('error', () => {});
      if (input) { try { child.stdin.write(input); } catch (_) {} }
      try { child.stdin.end(); } catch (_) {}

      /* stdout — hard cap at 8 MB */
      child.stdout.on('data', (chunk) => {
        outLen += chunk.length;
        if (outLen > STDOUT_LIMIT_BYTES) {
          killGroup(child.pid);
          done(reject, { status: 'output_limit_exceeded', message: 'Output Limit Exceeded (>8 MB)' });
          return;
        }
        outChunks.push(chunk);
      });

      /* stderr — cap at 64 KB */
      child.stderr.on('data', (chunk) => {
        errLen += chunk.length;
        if (errLen < STDERR_LIMIT_BYTES) errChunks.push(chunk);
        if (errLen > STDERR_LIMIT_BYTES * 4) killGroup(child.pid);
      });

      /* close — final disposition */
      child.on('close', (code, signal) => {
        if (settled) return;
        const stdout = Buffer.concat(outChunks).toString('utf8');
        const stderr = Buffer.concat(errChunks).toString('utf8').slice(0, STDERR_LIMIT_BYTES);
        if (signal === 'SIGKILL' || signal === 'SIGXCPU') {
          return done(reject, { status: 'time_limit_exceeded', message: 'Time Limit Exceeded' });
        }
        if (code !== 0 && code !== null) {
          return done(reject, {
            status: 'runtime_error',
            message: stderr || `Runtime Error (exit code ${code})`,
          });
        }
        done(resolve, stdout);
      });

      child.on('error', (err) => {
        done(reject, { status: 'system_error', message: err.message });
      });
    });
  }

  /* ── Single test-case wrapper ─────────────────────────────────── */
  async _runOneTestCase(tc, idx) {
    const t0 = Date.now();
    try {
      const output  = await this._runProcessWithInput(tc.input);
      const elapsed = Date.now() - t0;
      const passed  = normalise(tc.expected_output) === normalise(output);
      return {
        idx,
        testCaseId:     tc.id,
        status:         passed ? 'accepted' : 'wrong_answer',
        time:           elapsed,
        output,
        input:          tc.input,
        expectedOutput: tc.expected_output,
      };
    } catch (err) {
      return {
        idx,
        testCaseId: tc.id,
        status:     err.status || 'runtime_error',
        time:       Date.now() - t0,
        error:      err.message || 'Runtime error',
        output:     '',
        input:      tc.input,
      };
    }
  }

  /* ── Batch runner — dynamic concurrency ──────────────────────────
     Runs waves of MAX_CONCURRENT test-cases in parallel.
     Results are stored by index so order is always deterministic.
  ─────────────────────────────────────────────────────────────── */
  async runBatch(testCases) {
    if (!testCases || testCases.length === 0) {
      return { verdict: 'accepted', testCasesPassed: 0, totalTestCases: 0, timeTaken: 0, details: [] };
    }

    const results = new Array(testCases.length);
    for (let i = 0; i < testCases.length; i += MAX_CONCURRENT) {
      const wave = testCases.slice(i, i + MAX_CONCURRENT);
      const waveRes = await Promise.all(wave.map((tc, wi) => this._runOneTestCase(tc, i + wi)));
      for (const r of waveRes) results[r.idx] = r;

      // ── Fail-fast: stop as soon as any test case in this wave failed ──
      // Saves running remaining test cases when outcome is already known.
      if (waveRes.some(r => r.status !== 'accepted')) break;
    }

    const total   = testCases.length;
    const passed  = results.filter(r => r.status === 'accepted').length;
    const maxTime = Math.max(...results.map(r => r.time ?? 0));
    const fail    = results.find(r => r.status !== 'accepted');

    if (fail) {
      let msg = `--- ${fail.status.toUpperCase().replace(/_/g, ' ')} on Test Case ${fail.idx + 1} ---\n\n`;
      if (fail.status === 'wrong_answer') {
        msg += `[Input]\n${(fail.input || '').trim()}\n\n[Expected Output]\n${(fail.expectedOutput || '').trim()}\n\n[Your Output]\n${(fail.output || '').trim()}`;
      } else {
        msg += `[Input]\n${(fail.input || '').trim()}\n\n[Error Details]\n${fail.error || 'No details available'}`;
      }
      return { verdict: fail.status, testCasesPassed: passed, totalTestCases: total, timeTaken: maxTime, details: results, error: msg };
    }

    const sample = (results[0]?.output || '').trim() || '(No output)';
    return {
      verdict: 'accepted', testCasesPassed: passed, totalTestCases: total,
      timeTaken: maxTime, details: results,
      error: `--- All ${passed}/${total} test cases passed ---\n\nSample Output (Case 1):\n${sample}`,
    };
  }

  /* ── Cleanup ─────────────────────────────────────────────────── */
  async cleanup() {
    try { await fs.rm(this.baseDir, { recursive: true, force: true }); } catch (_) {}
  }

  /* ── SHA-256 cache key ─────────────────────────────────────────── */
  static hashFunction(code, language, cacheKey) {
    const lang = LANGUAGES[language] ? language : 'cpp';
    return crypto.createHash('sha256').update(`${lang}:${cacheKey}:${code}`).digest('hex');
  }
}

/* ── Helpers ──────────────────────────────────────────────────── */

/** Kill entire process group (handles fork bombs & child processes) */
function killGroup(pid) {
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); } catch (_) {
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
  }
}

/** Normalise output: trim each line, collapse trailing whitespace/newlines */
function normalise(s) {
  if (!s) return '';
  return s.trim().split('\n').map(l => l.trimEnd()).join('\n');
}

module.exports = Executor;

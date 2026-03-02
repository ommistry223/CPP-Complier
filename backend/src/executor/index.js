const { exec, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const crypto = require('crypto');

// Supported language configuration
const LANGUAGES = {
  'cpp': {
    extension: '.cpp',
    compileCmd: (file, out) => `g++ -O2 -std=c++17 -Wno-unused-result "${file}" -o "${out}"`,
    runCmd: (out) => `${out}`
  },
  'c': {
    extension: '.c',
    compileCmd: (file, out) => `gcc -O2 -std=c11 -Wno-unused-result "${file}" -o "${out}"`,
    runCmd: (out) => `${out}`
  }
};

class Executor {
  constructor(language, code, customTimeLimit, customMemoryLimit) {
    this.language = LANGUAGES[language] ? language : 'cpp';
    this.code = code;
    this.timeLimit = customTimeLimit || parseInt(process.env.MAX_EXECUTION_TIME) || 2000;
    this.memoryLimit = customMemoryLimit || parseInt(process.env.MAX_MEMORY_MB) || 256;

    this.config = LANGUAGES[this.language];
    this.runId = uuidv4();
    this.baseDir = path.join(__dirname, '..', '..', 'temp', this.runId);

    this.sourceFile = '';
    this.executable = '';
  }

  // Prepares the execution environment: creates temp dir, writes code.
  async prepare() {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });

      const fileName = `source${this.config.extension}`;
      this.sourceFile = path.join(this.baseDir, fileName);

      await fs.writeFile(this.sourceFile, this.code);

      // Use platform-agnostic naming for the binary
      this.executable = path.join(this.baseDir, 'solution.out');

      logger.debug(`Environment prepared for ${this.runId} (${this.language.toUpperCase()})`);
    } catch (err) {
      logger.error('Failed to prepare execution environment:', err);
      throw new Error('System error preparing execution');
    }
  }

  // Compiles the C++ code
  async compile() {
    const cmd = this.config.compileCmd(this.sourceFile, this.executable);

    return new Promise((resolve) => {
      exec(cmd, { timeout: 20000 }, (error, stdout, stderr) => {
        if (error) {
          logger.info(`Compilation failed for ${this.runId}`);

          let errMsg = (error ? error.message : '') + (stderr || stdout || 'Compilation Error');
          if (errMsg.includes('is not recognized') || errMsg.includes('command not found')) {
            errMsg = `The G++ compiler is not installed or not in the PATH. Please check your Docker setup.`;
          }

          return resolve({ success: false, error: errMsg });
        }
        resolve({ success: true });
      });
    });
  }

  // Executes a single test case — used internally by runBatch
  async _runOneTestCase(testCase, idx) {
    const startTime = Date.now();
    try {
      const output = await this._runProcessWithInput(this.executable, [], testCase.input);
      const timeElapsed = Date.now() - startTime;

      const expected = testCase.expected_output.trim().split('\n').map(l => l.trim()).join('\n');
      const actual   = output.trim().split('\n').map(l => l.trim()).join('\n');
      const passed   = expected === actual;

      return {
        idx,
        testCaseId: testCase.id,
        status:     passed ? 'accepted' : 'wrong_answer',
        time:       timeElapsed,
        output,
        input:          testCase.input,
        expectedOutput: testCase.expected_output,
      };
    } catch (err) {
      return {
        idx,
        testCaseId: testCase.id,
        status:  err.status || 'runtime_error',
        time:    Date.now() - startTime,
        error:   err.message || 'Runtime error',
        input:   testCase.input,
      };
    }
  }

  // Executes ALL test cases CONCURRENTLY (compile once, spawn all in parallel)
  async runBatch(testCases) {
    if (!testCases || testCases.length === 0) {
      return { verdict: 'accepted', testCasesPassed: 0, totalTestCases: 0, timeTaken: 0, memoryUsed: 0, details: [] };
    }

    // ── CONCURRENT execution — all test cases run simultaneously ──
    const results = await Promise.all(
      testCases.map((tc, i) => this._runOneTestCase(tc, i))
    );

    const totalTestCases = testCases.length;
    const passedCount    = results.filter(r => r.status === 'accepted').length;
    const maxTime        = Math.max(...results.map(r => r.time));

    // Find the first failure (sorted by index so report is deterministic)
    const firstFail = results.find(r => r.status !== 'accepted');

    if (firstFail) {
      const tcNum   = firstFail.idx + 1;
      const verdict = firstFail.status; // 'wrong_answer' | 'runtime_error' | 'time_limit_exceeded' etc.
      let msg = `--- ${verdict.toUpperCase().replace(/_/g, ' ')} on Test Case ${tcNum} ---\n\n`;

      if (verdict === 'wrong_answer') {
        msg += `[Input]\n${firstFail.input.trim()}\n\n`;
        msg += `[Expected Output]\n${firstFail.expectedOutput.trim()}\n\n`;
        msg += `[Your Output]\n${(firstFail.output || '').trim()}`;
      } else {
        msg += `[Input]\n${firstFail.input.trim()}\n\n`;
        msg += `[Error Details]\n${firstFail.error || 'No details available'}`;
      }

      return {
        verdict,
        testCasesPassed: passedCount,
        totalTestCases,
        timeTaken:  maxTime,
        memoryUsed: 0,
        details:    results,
        error:      msg,
      };
    }

    // All passed
    const sampleOut = results[0]?.output?.trim() || '(No output)';
    return {
      verdict:         'accepted',
      testCasesPassed: passedCount,
      totalTestCases,
      timeTaken:  maxTime,
      memoryUsed: 0,
      details:    results,
      error:      `--- All ${passedCount}/${totalTestCases} test cases passed ---\n\nSample Output (Case 1):\n${sampleOut}`,
    };
  }

  _runProcessWithInput(cmd, args, input) {
    return new Promise((resolve, reject) => {
      const process = spawn(cmd, args);

      let stdout = '';
      let stderr = '';

      const timeoutId = setTimeout(() => {
        process.kill('SIGKILL');
        reject({ status: 'time_limit_exceeded', message: 'Time Limit Exceeded' });
      }, this.timeLimit);

      // Suppress EPIPE: if the child closes stdin early, stdin.write() throws
      // an unhandled 'error' event that would crash the worker process.
      process.stdin.on('error', () => {});

      if (input) {
        try { process.stdin.write(input); } catch (_) { /* EPIPE — ignore */ }
      }
      try { process.stdin.end(); } catch (_) { /* EPIPE — ignore */ }

      process.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > 5 * 1024 * 1024) { // 5MB limit
          process.kill('SIGKILL');
          reject({ status: 'memory_limit_exceeded', message: 'Output Limit Exceeded' });
        }
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code !== 0 && code !== null) {
          reject({ status: 'runtime_error', message: stderr || `Process exited with code ${code}` });
        } else {
          resolve(stdout);
        }
      });

      process.on('error', (err) => {
        clearTimeout(timeoutId);
        reject({ status: 'system_error', message: err.message });
      });
    });
  }

  async cleanup() {
    try {
      await fs.rm(this.baseDir, { recursive: true, force: true });
    } catch (err) {
      logger.error('Failed to cleanup execution env:', err);
    }
  }

  static hashFunction(code, language, problemId) {
    const lang = LANGUAGES[language] ? language : 'cpp';
    return crypto.createHash('sha256').update(`${lang}:${problemId}:${code}`).digest('hex');
  }
}

module.exports = Executor;

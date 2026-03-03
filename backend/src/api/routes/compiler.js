const express = require('express');
const router  = express.Router();
const { enqueueCompilerJob, enqueueSubmitJob } = require('../../queue/compilerJobs');
const Executor     = require('../../executor');
const redisClient  = require('../../cache/redis');
const { getTestCases, getProblemById } = require('../../db');
const logger       = require('../../utils/logger');

/* ─── Shared job-await helper (used by both /run and /submit) ─── */
async function awaitJob(job, timeoutMs) {
    const expire = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Job timed out waiting for a worker')), timeoutMs)
    );
    // Also poll as fallback in case the 'finished' event misses
    const poll = new Promise((resolve, reject) => {
        const iv = setInterval(async () => {
            try {
                const state = await job.getState();
                if (state === 'completed') { clearInterval(iv); resolve(await job.returnvalue); }
                else if (state === 'failed') { clearInterval(iv); reject(new Error(job.failedReason || 'Job failed')); }
            } catch (_) {}
        }, 200);
        setTimeout(() => clearInterval(iv), timeoutMs);
    });
    return Promise.race([job.finished(), poll, expire]);
}

/* ─── Helper: clean up raw g++ stderr into readable Lines ───────────── */
function formatCompileError(raw) {
    if (!raw) return 'Compilation Error';
    return raw
        .split('\n')
        .map(line => line.replace(/^.*?source\.(cpp|c):/, 'Line'))
        .join('\n')
        .trim();
}

/* ─── In-memory TTL cache for problem metadata + test cases ──────────
   Avoids DB roundtrip on every submit when 80 teams hit the same 6
   problems.  TTL: 10 min (problems rarely change during a contest).
─────────────────────────────────────────────────────────────────────── */
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const _problemCache = new Map();   // problemId → { data, ts }
const _tcCache      = new Map();   // problemId → { data, ts }

async function cachedProblem(id) {
    const now = Date.now();
    const hit = _problemCache.get(id);
    if (hit && now - hit.ts < CACHE_TTL_MS) return hit.data;
    const data = await getProblemById(id);
    if (data) _problemCache.set(id, { data, ts: now });
    return data;
}

async function cachedTestCases(id) {
    const now = Date.now();
    const hit = _tcCache.get(id);
    if (hit && now - hit.ts < CACHE_TTL_MS) return hit.data;
    const data = await getTestCases(id);
    _tcCache.set(id, { data, ts: now });
    return data;
}

/* ─── Submit lock: prevents same team double-submitting concurrently ── */
const activeSubmissions = new Set();

/* ═══════════════════════════════════════════════════════════════════════
   POST /api/compiler/run
   "Run Code" with custom stdin — goes through Bull queue.
═══════════════════════════════════════════════════════════════════════ */
router.post('/run', async (req, res) => {
    const { language, code, input = '' } = req.body;

    // ── Input validation ───────────────────────────────────
    if (!language || !code) {
        return res.status(400).json({ error: 'Language and code are required.' });
    }

    if (!['cpp', 'c'].includes(language)) {
        return res.status(400).json({ error: 'Only C (c) and C++ (cpp) are supported.' });
    }

    if (code.length > 64 * 1024) {  // 64 KB code limit
        return res.status(400).json({ error: 'Code too large (max 64 KB).' });
    }

    // ── Enqueue & await with explicit timeout ──────────────
    try {
        const job = await enqueueCompilerJob(language, code, input);
        const JOB_TIMEOUT_MS = parseInt(process.env.JOB_WAIT_TIMEOUT_MS) || 35000;
        const result = await awaitJob(job, JOB_TIMEOUT_MS);
        return res.status(200).json(result);

    } catch (err) {
        const isTimeout = err.message && err.message.includes('timed out');
        return res.status(isTimeout ? 504 : 500).json({
            status: 'error',
            output: err.message || 'Worker execution queue error',
            time: null,
            memory: null,
        });
    }
});

/* ═══════════════════════════════════════════════════════════════════════
   POST /api/compiler/submit
   Game submission — enqueued to the submit-jobs worker queue.
   The API stays lean (no compilation in the HTTP process).
   Workers (3 replicas, WORKER_CONCURRENCY=20) run compile + test cases.

   Body  : { code, language, problemId, roomCode?, teamId? }
   Returns: { verdict, testCasesPassed, totalTestCases, timeTaken, error? }
═══════════════════════════════════════════════════════════════════════ */
router.post('/submit', async (req, res) => {
    const { language = 'cpp', code, problemId, roomCode, teamId } = req.body;

    // ── Validation ────────────────────────────────────────
    if (!code || !problemId) {
        return res.status(400).json({ verdict: 'system_error', error: 'code and problemId are required.' });
    }
    if (!['cpp', 'c'].includes(language)) {
        return res.status(400).json({ verdict: 'system_error', error: 'Unsupported language.' });
    }
    if (code.length > 64 * 1024) {
        return res.status(400).json({ verdict: 'system_error', error: 'Code too large (max 64 KB).' });
    }

    // ── Per-team duplicate-submit guard ──────────────────
    const lockKey = roomCode && teamId ? `${roomCode}:${teamId}` : null;
    if (lockKey) {
        if (activeSubmissions.has(lockKey)) {
            return res.status(429).json({
                verdict: 'system_error',
                error: 'Previous submission still running. Please wait.',
            });
        }
        activeSubmissions.add(lockKey);
    }

    try {
        // ── Fast Redis cache check before even queuing ────
        const codeHash = Executor.hashFunction(code, language, problemId);
        const cacheKey = `submit_cache:${codeHash}`;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                logger.info(`[submit] Cache HIT problem=${problemId}`);
                return res.json(JSON.parse(cached));
            }
        } catch (_) { /* Redis unavailable — continue to queue */ }

        // ── Enqueue to worker — all CPU work happens there ─
        const job = await enqueueSubmitJob({
            jobType: 'submit',
            language, code, problemId, roomCode, teamId, cacheKey,
        });

        const SUBMIT_TIMEOUT_MS = parseInt(process.env.SUBMIT_TIMEOUT_MS) || 85000;
        const result = await awaitJob(job, SUBMIT_TIMEOUT_MS);

        logger.info(
            `[submit] problem=${problemId} verdict=${result.verdict} ` +
            `passed=${result.testCasesPassed}/${result.totalTestCases} ` +
            `time=${result.timeTaken}ms`
        );
        return res.json(result);

    } catch (err) {
        const isTimeout = err.message?.includes('timed out');
        logger.error(`[submit] ${isTimeout ? 'TIMEOUT' : 'ERROR'}: ${err.message}`);
        return res.status(isTimeout ? 504 : 500).json({
            verdict: 'system_error',
            error: isTimeout
                ? 'Judging timed out — server is under high load. Please try again.'
                : 'System error during judging. Please try again.',
        });
    } finally {
        if (lockKey) activeSubmissions.delete(lockKey);
    }
});

module.exports = router;


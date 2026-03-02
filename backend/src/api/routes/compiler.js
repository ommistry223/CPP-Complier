const express = require('express');
const router = express.Router();
const { enqueueCompilerJob } = require('../../queue/compilerJobs');
const Executor = require('../../executor');
const redisClient = require('../../cache/redis');
const { getTestCases, getProblemById } = require('../../db');
const logger = require('../../utils/logger');

/* ─── Helper: clean up raw g++ stderr into readable Lines ───────────── */
function formatCompileError(raw) {
    if (!raw) return 'Compilation Error';
    return raw
        .split('\n')
        .map(line => line.replace(/^.*?source\.(cpp|c):/, 'Line'))
        .join('\n')
        .trim();
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

        const JOB_TIMEOUT_MS = parseInt(process.env.JOB_WAIT_TIMEOUT_MS) || 30000;

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error('Job timed out waiting for a worker')),
                JOB_TIMEOUT_MS
            )
        );

        const pollPromise = new Promise((resolve, reject) => {
            const interval = setInterval(async () => {
                try {
                    const state = await job.getState();
                    if (state === 'completed') {
                        clearInterval(interval);
                        resolve(await job.returnvalue);
                    } else if (state === 'failed') {
                        clearInterval(interval);
                        reject(new Error(job.failedReason || 'Job failed'));
                    }
                } catch (err) { /* ignore transient Redis errors */ }
            }, 400);
            setTimeout(() => clearInterval(interval), JOB_TIMEOUT_MS);
        });

        const result = await Promise.race([job.finished(), pollPromise, timeoutPromise]);
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
   Game submission — compiles ONCE, runs ALL test cases CONCURRENTLY.
   Does NOT go through Bull queue (one compile → parallel test runs).

   Body  : { code, problemId, roomCode?, teamId? }
   Returns: { verdict, testCasesPassed, totalTestCases, timeTaken, error?, details }
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

    // ── One-at-a-time lock per team (prevents double-submit) ──
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

    let executor = null;
    try {
        // ── 1. Load problem metadata (time/memory limits) ─
        const problem = await getProblemById(problemId);
        if (!problem) {
            return res.status(404).json({ verdict: 'system_error', error: 'Problem not found.' });
        }

        // ── 2. Load ALL test cases (hidden + sample) ──────
        const testCases = await getTestCases(problemId);
        if (testCases.length === 0) {
            return res.status(422).json({ verdict: 'system_error', error: 'No test cases configured for this problem.' });
        }

        // ── 3. Redis cache: avoid re-judging identical code ──
        const codeHash = Executor.hashFunction(code, language, problemId);
        const cacheKey = `submit_cache:${codeHash}`;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                logger.info(`[submit] Cache HIT problem=${problemId}`);
                return res.json(JSON.parse(cached));
            }
        } catch (_) { /* Redis down — fall through to compile */ }

        // ── 4. Compile code once ──────────────────────────
        executor = new Executor(language, code, problem.time_limit, problem.memory_limit);
        await executor.prepare();

        const compileResult = await executor.compile();
        if (!compileResult.success) {
            return res.json({
                verdict: 'compilation_error',
                testCasesPassed: 0,
                totalTestCases: testCases.length,
                timeTaken: null,
                error: formatCompileError(compileResult.error),
            });
        }

        // ── 5. Run ALL test cases CONCURRENTLY ────────────
        //   Each test case gets its own spawned process.
        //   Promise.all means they all run at the same time.
        const batchResult = await executor.runBatch(testCases);

        // ── 6. Cache accepted verdicts for 1 hour ─────────
        if (batchResult.verdict === 'accepted') {
            try {
                await redisClient.setex(cacheKey, 3600, JSON.stringify(batchResult));
            } catch (_) { /* non-critical */ }
        }

        logger.info(
            `[submit] problem=${problemId} verdict=${batchResult.verdict} ` +
            `passed=${batchResult.testCasesPassed}/${batchResult.totalTestCases} ` +
            `time=${batchResult.timeTaken}ms`
        );
        return res.json(batchResult);

    } catch (err) {
        logger.error('[submit] Unexpected error:', err.message);
        return res.status(500).json({ verdict: 'system_error', error: 'System error during judging. Please try again.' });
    } finally {
        if (lockKey) activeSubmissions.delete(lockKey);
        if (executor) await executor.cleanup().catch(() => {});
    }
});

module.exports = router;


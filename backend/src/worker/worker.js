require('dotenv').config();
const { compilerQueue, submitQueue } = require('../queue/compilerJobs');
const Executor = require('../executor');
const logger = require('../utils/logger');
const os   = require('os');
const path = require('path');
const fs   = require('fs').promises;
const redisClient = require('../cache/redis');
const { pool } = require('../db');

const workerId  = `${os.hostname()}-${process.pid}`;
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY) || os.cpus().length * 2;

// ── Resilient error handlers — log but don't exit for recoverable errors ──
// Only exit if we can prove the process is in a truly unsafe state.
process.on('uncaughtException', (err) => {
  logger.error(`[${workerId}] Uncaught exception:`, err.message, err.stack);
  // Only hard-exit for ENOMEM / assertion failures (unrecoverable)
  if (err.code === 'ENOMEM' || err.message?.includes('assert')) {
    process.exit(1);
  }
  // Otherwise stay alive — the executor already handles its own errors
});
process.on('unhandledRejection', (reason) => {
  logger.warn(`[${workerId}] Unhandled rejection (non-fatal):`, reason);
  // Don't exit — rejection was likely from a timed-out child process
});

logger.info(`Starting Worker ${workerId} with concurrency=${CONCURRENCY}`);

// ── Clean up stale temp dirs left over from prior crashes ──────────────
async function cleanStaleTempDirs() {
  const tempRoot = path.join(__dirname, '..', '..', 'temp');
  try {
    const entries = await fs.readdir(tempRoot);
    const cutoff  = Date.now() - 30 * 60 * 1000; // older than 30 min
    let cleaned = 0;
    for (const entry of entries) {
      const full = path.join(tempRoot, entry);
      try {
        const stat = await fs.stat(full);
        if (stat.isDirectory() && stat.ctimeMs < cutoff) {
          await fs.rm(full, { recursive: true, force: true });
          cleaned++;
        }
      } catch (_) {}
    }
    if (cleaned > 0) logger.info(`[${workerId}] Cleaned ${cleaned} stale temp dirs on startup`);
  } catch (_) {}
}
cleanStaleTempDirs();

const { getTestCases, getProblemById } = require('../db');

/* ── /run jobs (plain code execution against custom stdin) ── */
compilerQueue.process(CONCURRENCY, async (job) => {
  const { language, code, input } = job.data;

  if (!['cpp', 'c'].includes(language)) {
    return { status: 'error', output: 'Unsupported language.', time: null };
  }
  logger.info(`[${workerId}] /run job ${job.id}`);

  let executor = null;
  try {
    // Redis cache
    const cacheKey = `compiler_cache:${Executor.hashFunction(code, language, input)}`;
    try {
      const hit = await redisClient.get(cacheKey);
      if (hit) { logger.info(`[${workerId}] /run cache HIT`); return JSON.parse(hit); }
    } catch (_) {}

    // Compile
    executor = new Executor(language, code);
    await executor.prepare();
    const compileResult = await executor.compile();
    if (!compileResult.success) {
      return { status: 'error', output: compileResult.error, time: null };
    }

    const startTime = Date.now();
    const output = await executor._runProcessWithInput(input || '');
    const timeElapsed = Date.now() - startTime;

    logger.info(`[${workerId}] Job ${job.id} done in ${timeElapsed}ms`);

    const result = {
      status: 'success',
      output,
      time: timeElapsed,
      memory: null,
    };

    // ── 4. Cache result (1 hour TTL) ──────────────────
    try {
      await redisClient.setex(cacheKey, 3600, JSON.stringify(result));
    } catch (err) {
      logger.warn(`[${workerId}] Redis cache write error: ${err.message}`);
    }

    return result;

  } catch (error) {
    logger.error(`[${workerId}] Error on job ${job.id}: ${error.message}`);
    return {
      status: 'error',
      output: error.message || 'Execution Error',
      time: null,
      memory: null,
    };
  } finally {
    if (executor) await executor.cleanup().catch(() => {});
  }
});

/* ── /submit jobs (compile once → judge all test cases) ─────
   These run in the submit-jobs queue at the same concurrency.
   All CPU work is isolated here — API stays non-blocking.
──────────────────────────────────────────────────────────── */
// Submit concurrency can be tuned separately — default = same
const SUBMIT_CONCURRENCY = parseInt(process.env.SUBMIT_CONCURRENCY) || CONCURRENCY;
logger.info(`[${workerId}] submit concurrency=${SUBMIT_CONCURRENCY}`);

submitQueue.process(SUBMIT_CONCURRENCY, async (job) => {
  const { language, code, problemId, cacheKey } = job.data;

  if (!['cpp', 'c'].includes(language) || !problemId) {
    return { verdict: 'system_error', error: 'Invalid job payload.', testCasesPassed: 0, totalTestCases: 0 };
  }

  logger.info(`[${workerId}] /submit job ${job.id} problem=${problemId}`);

  // ── 1. Redis result cache (same hash key set by API) ──
  if (cacheKey) {
    try {
      const hit = await redisClient.get(cacheKey);
      if (hit) {
        logger.info(`[${workerId}] /submit cache HIT problem=${problemId}`);
        return JSON.parse(hit);
      }
    } catch (_) {}
  }

  // ── 2. Load problem + test cases ──────────────────────
  const [problem, testCases] = await Promise.all([
    getProblemById(problemId),
    getTestCases(problemId),
  ]);

  if (!problem) {
    return { verdict: 'system_error', error: 'Problem not found.', testCasesPassed: 0, totalTestCases: 0 };
  }
  if (!testCases.length) {
    return { verdict: 'system_error', error: 'No test cases found.', testCasesPassed: 0, totalTestCases: 0 };
  }

  let executor = null;
  try {
    // ── 3. Compile ────────────────────────────────────────
    executor = new Executor(language, code, problem.time_limit, problem.memory_limit);
    await executor.prepare();

    const compileResult = await executor.compile();
    if (!compileResult.success) {
      return {
        verdict: 'compilation_error',
        testCasesPassed: 0,
        totalTestCases: testCases.length,
        timeTaken: null,
        error: compileResult.error,
      };
    }

    // ── 4. Run all test cases ─────────────────────────────
    const result = await executor.runBatch(testCases);

    // ── 5. Cache accepted results for 1 hour ──────────────
    if (result.verdict === 'accepted' && cacheKey) {
      try { await redisClient.setex(cacheKey, 3600, JSON.stringify(result)); } catch (_) {}
    }

    logger.info(
      `[${workerId}] /submit job ${job.id} verdict=${result.verdict} ` +
      `passed=${result.testCasesPassed}/${result.totalTestCases} time=${result.timeTaken}ms`
    );
    return result;

  } catch (err) {
    logger.error(`[${workerId}] /submit job ${job.id} error: ${err.message}`);
    return { verdict: 'system_error', error: err.message, testCasesPassed: 0, totalTestCases: 0 };
  } finally {
    if (executor) await executor.cleanup().catch(() => {});
  }
});

// ── Graceful shutdown ─────────────────────────────────────
async function shutdown(signal) {
  logger.info(`Worker ${workerId} received ${signal}, draining queue...`);
  // Stop accepting new jobs; finish in-progress ones
  await Promise.all([compilerQueue.close(), submitQueue.close()]);
  await redisClient.quit().catch(() => { });
  try { await pool.end(); } catch (_) { }
  logger.info(`Worker ${workerId} shut down cleanly.`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

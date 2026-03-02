require('dotenv').config();
const { compilerQueue } = require('../queue/compilerJobs');
const Executor = require('../executor');
const logger = require('../utils/logger');
const os = require('os');
const redisClient = require('../cache/redis');
const { pool } = require('../db');

// Identity string used in all log lines for this worker instance
const workerId = `${os.hostname()}-${process.pid}`;
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY) || 4;  // default 4 (was 1)

// ── Prevent a single EPIPE / uncaught error from killing the worker process ──
process.on('uncaughtException', (err) => {
  logger.error(`[${workerId}] Uncaught exception (worker kept alive):`, err.message);
});
process.on('unhandledRejection', (reason) => {
  logger.error(`[${workerId}] Unhandled rejection (worker kept alive):`, reason);
});

logger.info(`Starting Worker ${workerId} with concurrency=${CONCURRENCY}`);

// ── Process jobs from the shared Bull queue ────────────────
compilerQueue.process(CONCURRENCY, async (job) => {
  const { language, code, input } = job.data;

  // Safety check
  if (!['cpp', 'c'].includes(language)) {
    logger.warn(`[${workerId}] Job ${job.id}: unsupported language ${language}`);
    return { status: 'error', output: 'Only C (c) and C++ (cpp) are supported.', time: null, memory: null };
  }

  logger.info(`[${workerId}] Processing job ${job.id}`);

  let executor = null;

  try {
    // ── 1. Redis cache look-up ─────────────────────────
    const codeHash = Executor.hashFunction(code, language, input);
    const cacheKey = `compiler_cache:${codeHash}`;

    try {
      const cachedResultStr = await redisClient.get(cacheKey);
      if (cachedResultStr) {
        logger.info(`[${workerId}] Cache HIT for job ${job.id}`);
        return JSON.parse(cachedResultStr);
      }
    } catch (err) {
      // Cache miss is fine; continue to compile
      logger.warn(`[${workerId}] Redis cache read error: ${err.message}`);
    }

    // ── 2. Prepare + compile ──────────────────────────
    executor = new Executor(language, code);
    await executor.prepare();

    const compileResult = await executor.compile();
    if (!compileResult.success) {
      logger.info(`[${workerId}] Compilation error for job ${job.id}`);
      return {
        status: 'error',
        output: compileResult.error,
        time: null,
        memory: null,
      };
    }

    // ── 3. Execute ────────────────────────────────────
    const cmd = executor.executable;
    const args = [];

    const startTime = Date.now();
    const output = await executor._runProcessWithInput(cmd, args, input || '');
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
    if (executor) {
      // Always clean up temp directory to avoid disk leaks
      await executor.cleanup().catch(err =>
        logger.warn(`[${workerId}] Cleanup error: ${err.message}`)
      );
    }
  }
});

// ── Graceful shutdown ─────────────────────────────────────
async function shutdown(signal) {
  logger.info(`Worker ${workerId} received ${signal}, draining queue...`);
  // Stop accepting new jobs; finish in-progress ones
  await compilerQueue.close();
  await redisClient.quit().catch(() => { });
  try { await pool.end(); } catch (_) { }
  logger.info(`Worker ${workerId} shut down cleanly.`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

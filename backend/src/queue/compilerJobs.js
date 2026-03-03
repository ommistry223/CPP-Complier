const Queue = require('bull');
const logger = require('../utils/logger');

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    // Bull uses 3 Redis connections per queue instance.
    // Enable keepalive so they survive long idle periods.
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    connectTimeout: 10000,
    lazyConnect: false,
};

const compilerQueue = new Queue('compiler-jobs', {
    redis: redisConfig,
    defaultJobOptions: {
        attempts: 1,         // never retry — code execution must be idempotent
        removeOnComplete: true,      // keep Redis lean
        removeOnFail: false,     // keep failed jobs for post-mortem
        timeout: 45000,     // Bull-level kill: 45s (worker must finish in this time)
        backoff: { type: 'fixed', delay: 0 },
    },
    settings: {
        // Bull uses 5s lock TTL by default; for slow compiles increase it
        lockDuration: 30000,      // 30s lock per job
        lockRenewTime: 10000,      // renew every 10s
        stalledInterval: 30000,      // check for stalled jobs every 30s
        maxStalledCount: 1,          // fail after 1 stall (not retry)
    },
});

compilerQueue.on('error', (err) => logger.error('Queue Error:', err));
compilerQueue.on('failed', (job, err) => logger.error(`Job ${job.id} failed:`, err.message));
compilerQueue.on('stalled', (job) => logger.warn(`Job ${job.id} stalled!`));

const enqueueCompilerJob = async (language, code, input) => {
    try {
        const job = await compilerQueue.add(
            { language, code, input },
            { priority: 1 }
        );
        logger.info(`Compiler job enqueued: ${job.id}`);
        return job;
    } catch (error) {
        logger.error('Failed to enqueue compiler job:', error);
        throw error;
    }
};

/* ─────────────────────────────────────────────────────────────────────
   Submit queue — handles full judge jobs (compile + all test cases).
   Separate queue so /submit jobs don't starve or mix with /run jobs.
   Higher timeout (90s) because we run batches of test cases.
───────────────────────────────────────────────────────────────────── */
const submitQueue = new Queue('submit-jobs', {
    redis: redisConfig,
    defaultJobOptions: {
        attempts:         1,
        removeOnComplete: true,
        removeOnFail:     false,
        timeout:          90000,   // 90s — covers compile + many test cases
        backoff:          { type: 'fixed', delay: 0 },
    },
    settings: {
        lockDuration:    60000,
        lockRenewTime:   15000,
        stalledInterval: 30000,
        maxStalledCount: 1,
    },
});

submitQueue.on('error',  (err)       => logger.error('Submit Queue Error:', err));
submitQueue.on('failed', (job, err)  => logger.error(`Submit job ${job.id} failed:`, err.message));
submitQueue.on('stalled',(job)       => logger.warn(`Submit job ${job.id} stalled!`));

const enqueueSubmitJob = async (payload) => {
    try {
        const job = await submitQueue.add(payload, { priority: 1 });
        logger.info(`Submit job enqueued: ${job.id} problem=${payload.problemId}`);
        return job;
    } catch (error) {
        logger.error('Failed to enqueue submit job:', error);
        throw error;
    }
};

module.exports = { compilerQueue, enqueueCompilerJob, submitQueue, enqueueSubmitJob };

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
            {
                // Per-job priority: higher = processed sooner
                // All jobs start equal (priority 1) but you can
                // pass a different value from the route if needed.
                priority: 1,
            }
        );
        logger.info(`Compiler job enqueued: ${job.id}`);
        return job;
    } catch (error) {
        logger.error('Failed to enqueue compiler job:', error);
        throw error;
    }
};

module.exports = { compilerQueue, enqueueCompilerJob };

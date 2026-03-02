const Queue = require('bull');
const logger = require('../utils/logger');

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
};

const submissionQueue = new Queue('code-submissions', {
    redis: redisConfig,
    defaultJobOptions: {
        attempts: 1, // Only try once for code execution
        removeOnComplete: true, // Keep Redis clean
        removeOnFail: false, // Keep failed jobs for debugging
        timeout: 30000, // Master timeout 30s
    }
});

submissionQueue.on('error', (err) => {
    logger.error('Queue Error:', err);
});

submissionQueue.on('failed', (job, err) => {
    logger.error(`Job ${job.id} failed:`, err);
});

submissionQueue.on('stalled', (job) => {
    logger.warn(`Job ${job.id} stalled!`);
});

const enqueueSubmission = async (submissionId) => {
    try {
        const job = await submissionQueue.add({ submissionId });
        logger.info(`Submission ${submissionId} enqueued as Job ${job.id}`);
        return job.id;
    } catch (error) {
        logger.error('Failed to enqueue submission:', error);
        throw error;
    }
};

module.exports = { submissionQueue, enqueueSubmission };

const Redis = require('ioredis');
const logger = require('../utils/logger');

const redisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    // Keep connections alive across long idle periods (LAN workers may be idle)
    keepAlive: 30000,
    connectTimeout: 10000,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

const redisClient = new Redis(redisOptions);

redisClient.on('connect', () => {
    logger.info('Connected to Redis cache');
});

redisClient.on('error', (err) => {
    logger.error('Redis connection error:', err);
});

module.exports = redisClient;

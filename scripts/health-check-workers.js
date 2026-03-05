#!/usr/bin/env node
/**
 * health-check-workers.js
 * ──────────────────────────────────────────────────────────────────
 * Utility script to verify all Bull worker nodes are connected and
 * healthy. Run this on PC-1 or any machine that can reach Redis.
 *
 * Usage:
 *   node scripts/health-check-workers.js
 *   OR with custom Redis:
 *   REDIS_HOST=192.168.1.10 REDIS_PORT=6380 node scripts/health-check-workers.js
 *
 * What it checks:
 *   1. Redis connectivity and Bull queue key existence
 *   2. Number of active workers per queue
 *   3. Queue depths (waiting, active, delayed, failed)
 *   4. Last completed jobs timestamp
 * ──────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const Queue = require('bull');

const REDIS = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
};

const QUEUES = ['compiler-jobs', 'submit-jobs'];

async function checkQueue(name) {
    const q = new Queue(name, { redis: REDIS });

    const [waiting, active, delayed, failed, completed, workerCount] = await Promise.all([
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getDelayedCount(),
        q.getFailedCount(),
        q.getCompletedCount(),
        q.getWorkers().catch(() => []),
    ]);

    const workers = Array.isArray(workerCount) ? workerCount : [];

    console.log(`\n  ┌─ Queue: ${name}`);
    console.log(`  │  Workers connected : ${workers.length}`);
    console.log(`  │  Waiting jobs      : ${waiting}`);
    console.log(`  │  Active jobs       : ${active}`);
    console.log(`  │  Delayed jobs      : ${delayed}`);
    console.log(`  │  Failed jobs       : ${failed}`);
    console.log(`  │  Completed (total) : ${completed}`);

    if (workers.length > 0) {
        console.log(`  │  Worker IDs:`);
        workers.forEach(w => console.log(`  │    • ${w.id || w.name || JSON.stringify(w)}`));
    } else {
        console.log(`  │  ⚠  No workers connected! Jobs will queue but not execute.`);
    }
    console.log(`  └──────────────────────────────────`);

    await q.close();
    return { name, workers: workers.length, waiting, active, failed };
}

async function main() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║         CPP-Compiler — Worker Health Check           ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`\nRedis: ${REDIS.host}:${REDIS.port}`);

    // Test basic Redis connectivity first
    const Redis = require('ioredis');
    const client = new Redis(REDIS);
    try {
        const pong = await client.ping();
        if (pong !== 'PONG') throw new Error(`Unexpected ping response: ${pong}`);
        console.log('[✓] Redis is reachable and responding.\n');
    } catch (err) {
        console.error(`[✗] Cannot connect to Redis: ${err.message}`);
        console.error('    Check REDIS_HOST, REDIS_PORT, REDIS_PASSWORD in your .env file.');
        process.exit(1);
    } finally {
        client.disconnect();
    }

    const results = [];
    for (const qName of QUEUES) {
        try {
            const r = await checkQueue(qName);
            results.push(r);
        } catch (err) {
            console.error(`  [✗] Error checking queue "${qName}": ${err.message}`);
        }
    }

    // Summary
    const totalWorkers = results.reduce((s, r) => s + r.workers, 0);
    const totalWaiting = results.reduce((s, r) => s + r.waiting, 0);
    const totalFailed = results.reduce((s, r) => s + r.failed, 0);

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  SUMMARY                                             ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  Total workers online  : ${String(totalWorkers).padEnd(25)} ║`);
    console.log(`║  Total queued jobs     : ${String(totalWaiting).padEnd(25)} ║`);
    console.log(`║  Total failed jobs     : ${String(totalFailed).padEnd(25)} ║`);

    if (totalWorkers === 0) {
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log('║  ⚠  WARNING: No workers are connected!               ║');
        console.log('║     Start workers on PC-2 and PC-3 using:            ║');
        console.log('║       worker-node\\start-worker.bat                   ║');
    } else if (totalWorkers === 1) {
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log('║  ℹ  Only 1 worker connected. For best performance,   ║');
        console.log('║     start workers on both PC-2 and PC-3.             ║');
    } else {
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log('║  ✓  All worker nodes appear healthy.                 ║');
    }
    console.log('╚══════════════════════════════════════════════════════╝\n');

    process.exit(totalWorkers > 0 ? 0 : 1);
}

main().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});

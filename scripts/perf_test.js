/**
 * ============================================================
 *  CodeRunner — QA Performance & Load Test Suite
 *  Target : http://localhost  (Nginx → api1/api2 → workers)
 *  Author : QA Bot (Antigravity)
 * ============================================================
 */

const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ──────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || 'http://localhost';
const REPORT_DIR = path.join(__dirname, '..', 'qa_reports');

const TESTS = [
    { name: 'Smoke Test', concurrency: 1, totalRequests: 5, rampSeconds: 0 },
    { name: 'Light Load (10 VU)', concurrency: 10, totalRequests: 50, rampSeconds: 2 },
    { name: 'Medium Load (50 VU)', concurrency: 50, totalRequests: 250, rampSeconds: 5 },
    { name: 'Heavy Load (100 VU)', concurrency: 100, totalRequests: 500, rampSeconds: 10 },
    { name: 'Stress (200 VU)', concurrency: 200, totalRequests: 600, rampSeconds: 15 },
    { name: 'Spike (500 VU)', concurrency: 500, totalRequests: 600, rampSeconds: 5 },
];

// C++ payloads (simple → heavy)
const PAYLOADS = [
    {
        label: 'Hello World',
        language: 'cpp',
        code: '#include<iostream>\nusing namespace std;\nint main(){cout<<"Hello World";return 0;}',
        input: '',
    },
    {
        label: 'Fibonacci(30)',
        language: 'cpp',
        code: '#include<iostream>\nusing namespace std;\nint fib(int n){if(n<=1)return n;return fib(n-1)+fib(n-2);}\nint main(){cout<<fib(30);return 0;}',
        input: '',
    },
    {
        label: 'Bubble Sort 1000',
        language: 'cpp',
        code: `#include<iostream>
#include<algorithm>
#include<vector>
using namespace std;
int main(){
  vector<int> v;
  for(int i=1000;i>=1;i--) v.push_back(i);
  sort(v.begin(),v.end());
  cout<<v[0]<<" "<<v[999];
  return 0;
}`,
        input: '',
    },
];

// ─── HELPERS ─────────────────────────────────────────────────

function request(url, method, body, vuIndex = 0) {
    return new Promise((resolve) => {
        const start = performance.now();
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const bodyData = body ? JSON.stringify(body) : null;

        // Simulate unique user IPs so rate-limit buckets are per-VU (like real users)
        // Each VU gets IP 10.VU_BLOCK.VU_HOST.1 — all unique, within RFC-1918 space
        const vuIp = `10.${Math.floor(vuIndex / 254)}.${vuIndex % 254 + 1}.1`;

        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-For': vuIp,       // simulate unique real-user IP per VU
                'X-Real-IP': vuIp,
                ...(bodyData ? { 'Content-Length': Buffer.byteLength(bodyData) } : {}),
            },
            timeout: 120000,  // 120s — must exceed server's JOB_WAIT_TIMEOUT_MS (90s)
        };

        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                const end = performance.now();
                resolve({
                    statusCode: res.statusCode,
                    body: data,
                    latencyMs: Math.round(end - start),
                    error: null,
                });
            });
        });

        req.on('error', (err) => {
            const end = performance.now();
            resolve({
                statusCode: 0,
                body: '',
                latencyMs: Math.round(end - performance.now() + (performance.now() - start)),
                error: err.message,
            });
        });

        req.on('timeout', () => {
            req.destroy();
            const end = performance.now();
            resolve({
                statusCode: 0,
                body: '',
                latencyMs: 120000,
                error: 'TIMEOUT',
            });
        });

        if (bodyData) req.write(bodyData);
        req.end();
    });
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function calcStats(latencies) {
    if (!latencies.length) return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    return {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: Math.round(sum / sorted.length),
        p50: percentile(sorted, 50),
        p90: percentile(sorted, 90),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
    };
}

// ─── ENDPOINT TESTS ──────────────────────────────────────────

async function testHealthCheck() {
    console.log('\n🩺  [1/4] Health Check Endpoint Test');
    const result = await request(`${BASE_URL}/health`, 'GET', null);
    const ok = result.statusCode === 200;
    console.log(`     Status: ${result.statusCode} | Latency: ${result.latencyMs}ms | ✅ ${ok ? 'PASS' : '❌ FAIL'}`);
    if (!ok) console.log(`     Body: ${result.body.slice(0, 200)}`);
    return { endpoint: '/health', status: result.statusCode, latencyMs: result.latencyMs, pass: ok };
}

async function testFrontend() {
    console.log('\n🌐  [2/4] Frontend Availability Test');
    const result = await request(`${BASE_URL}/`, 'GET', null);
    const ok = result.statusCode === 200;
    console.log(`     Status: ${result.statusCode} | Latency: ${result.latencyMs}ms | ${ok ? '✅ PASS' : '❌ FAIL'}`);
    return { endpoint: '/', status: result.statusCode, latencyMs: result.latencyMs, pass: ok };
}

async function testCompilerEndpoint() {
    console.log('\n⚙️   [3/4] Compiler Endpoint Functional Test');
    const results = [];
    for (const payload of PAYLOADS) {
        const result = await request(`${BASE_URL}/api/compiler/run`, 'POST', payload);
        let parsed = {};
        try { parsed = JSON.parse(result.body); } catch { }
        const ok = result.statusCode === 200 && parsed.status === 'success';
        console.log(`     [${payload.label}] Status: ${result.statusCode} | Latency: ${result.latencyMs}ms | ${ok ? '✅ PASS' : '❌ FAIL'}`);
        if (!ok) console.log(`       → ${result.body.slice(0, 300)}`);
        results.push({ label: payload.label, status: result.statusCode, latencyMs: result.latencyMs, pass: ok, output: parsed.output });
    }
    return results;
}

// ─── LOAD TEST ────────────────────────────────────────────────

async function runLoadTest(testConfig) {
    const { name, concurrency, totalRequests, rampSeconds } = testConfig;
    console.log(`\n🔥  [4/4] Load Test — ${name}`);
    console.log(`     VUs: ${concurrency} | Total Requests: ${totalRequests} | Ramp: ${rampSeconds}s`);

    const payload = PAYLOADS[0]; // use hello-world for load test (fastest)
    const results = [];
    let completed = 0;
    let errors = 0;
    let rateLimited = 0;
    let timeouts = 0;

    const startTime = performance.now();

    // Build a queue of work
    const tasks = Array.from({ length: totalRequests }, (_, i) => i);

    // Worker coroutine: each worker has a fixed vuIndex so it gets its own IP bucket
    async function worker(vuIndex) {
        while (tasks.length > 0) {
            tasks.shift(); // claim a task
            const res = await request(`${BASE_URL}/api/compiler/run`, 'POST', payload, vuIndex);
            completed++;
            if (res.error === 'TIMEOUT') timeouts++;
            else if (res.statusCode === 429) rateLimited++;
            else if (res.statusCode !== 200 || res.error) errors++;
            results.push({ statusCode: res.statusCode, latencyMs: res.latencyMs, error: res.error });

            if (completed % 50 === 0) {
                const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
                const rps = (completed / ((performance.now() - startTime) / 1000)).toFixed(1);
                process.stdout.write(`\r     Progress: ${completed}/${totalRequests} | Elapsed: ${elapsed}s | RPS: ${rps}  `);
            }
        }
    }

    // Spawn concurrent workers with optional ramp-up; pass VU index for unique IP
    const workers = [];
    if (rampSeconds > 0) {
        const batchSize = Math.max(1, Math.floor(concurrency / (rampSeconds * 2)));
        let spawned = 0;
        while (spawned < concurrency) {
            const thisBatch = Math.min(batchSize, concurrency - spawned);
            for (let i = 0; i < thisBatch; i++) {
                workers.push(worker(spawned + i));
            }
            spawned += thisBatch;
            await sleep((rampSeconds * 1000) / (concurrency / batchSize));
        }
    } else {
        for (let i = 0; i < concurrency; i++) workers.push(worker(i));
    }

    await Promise.all(workers);
    const totalMs = performance.now() - startTime;
    console.log(); // newline after progress

    const successResults = results.filter(r => r.statusCode === 200 && !r.error);
    const latencies = successResults.map(r => r.latencyMs);
    const stats = calcStats(latencies);
    const rps = ((completed / totalMs) * 1000).toFixed(2);
    const successRate = ((successResults.length / completed) * 100).toFixed(1);
    const errorRate = ((errors / completed) * 100).toFixed(1);

    console.log(`     ✅ Success: ${successResults.length}/${completed} (${successRate}%)`);
    console.log(`     ❌ Errors: ${errors} | 🚫 Rate-Limited: ${rateLimited} | ⏱ Timeouts: ${timeouts}`);
    console.log(`     📈 RPS: ${rps} | Latency p50/p90/p99: ${stats.p50}ms / ${stats.p90}ms / ${stats.p99}ms`);

    return {
        testName: name,
        concurrency,
        totalRequests: completed,
        successCount: successResults.length,
        errorCount: errors,
        rateLimitedCount: rateLimited,
        timeoutCount: timeouts,
        successRatePct: parseFloat(successRate),
        errorRatePct: parseFloat(errorRate),
        throughputRPS: parseFloat(rps),
        durationMs: Math.round(totalMs),
        latency: stats,
    };
}

// ─── CONTAINER STATS ─────────────────────────────────────────

async function collectDockerStats() {
    return new Promise((resolve) => {
        const { exec } = require('child_process');
        exec(
            'docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.NetIO}},{{.BlockIO}}"',
            { timeout: 15000 },
            (err, stdout) => {
                if (err) return resolve([]);
                const rows = stdout.trim().split('\n').map(line => {
                    const [name, cpu, mem, net, block] = line.split(',');
                    return { name, cpu, mem, net, block };
                });
                resolve(rows);
            }
        );
    });
}

// ─── REPORT GENERATION ───────────────────────────────────────

function gradePerformance(stats) {
    if (stats.successRatePct >= 99 && stats.latency.p99 < 3000) return { grade: 'A', label: 'Excellent' };
    if (stats.successRatePct >= 95 && stats.latency.p99 < 6000) return { grade: 'B', label: 'Good' };
    if (stats.successRatePct >= 90 && stats.latency.p99 < 10000) return { grade: 'C', label: 'Acceptable' };
    if (stats.successRatePct >= 80) return { grade: 'D', label: 'Poor' };
    return { grade: 'F', label: 'Critical' };
}

function generateMarkdownReport(data) {
    const { timestamp, health, frontend, functional, loadResults, dockerStats, issues } = data;

    const gradeEmoji = { A: '🟢', B: '🟡', C: '🟠', D: '🔴', F: '💀' };

    let md = `# 🧪 CodeRunner — QA Performance Report
> **Generated:** ${timestamp}
> **Target:** ${BASE_URL}
> **Tester:** Antigravity QA Bot

---

## 1. 🩺 Health & Availability

| Endpoint | HTTP Status | Latency | Result |
|----------|------------|---------|--------|
| \`/health\`| ${health.status} | ${health.latencyMs}ms | ${health.pass ? '✅ PASS' : '❌ FAIL'} |
| \`/\` (Frontend) | ${frontend.status} | ${frontend.latencyMs}ms | ${frontend.pass ? '✅ PASS' : '❌ FAIL'} |

---

## 2. ⚙️ Functional Tests (Compiler API)

| Test Case | HTTP Status | Latency | Result |
|-----------|------------|---------|--------|
${functional.map(f => `| ${f.label} | ${f.status} | ${f.latencyMs}ms | ${f.pass ? '✅ PASS' : '❌ FAIL'} |`).join('\n')}

---

## 3. 🔥 Load Test Results

| Scenario | VUs | Requests | Success% | Error% | RPS | p50 | p90 | p95 | p99 | Grade |
|----------|-----|----------|----------|--------|-----|-----|-----|-----|-----|-------|
${loadResults.map(r => {
        const g = gradePerformance(r);
        return `| ${r.testName} | ${r.concurrency} | ${r.totalRequests} | ${r.successRatePct}% | ${r.errorRatePct}% | ${r.throughputRPS} | ${r.latency.p50}ms | ${r.latency.p90}ms | ${r.latency.p95}ms | ${r.latency.p99}ms | ${gradeEmoji[g.grade]} ${g.grade} – ${g.label} |`;
    }).join('\n')}

---

## 4. 🐳 Docker Container Resource Usage (at time of report)

| Container | CPU% | Memory | Network I/O | Block I/O |
|-----------|------|--------|-------------|-----------|
${dockerStats.length > 0
            ? dockerStats.map(s => `| \`${s.name}\` | ${s.cpu} | ${s.mem} | ${s.net} | ${s.block} |`).join('\n')
            : '| *Could not retrieve Docker stats* | — | — | — | — |'}

---

## 5. 🐛 Issues Found

${issues.length === 0
            ? '> ✅ No critical issues detected during this test run.'
            : issues.map((issue, i) => `### Issue ${i + 1}: ${issue.title}\n- **Severity:** ${issue.severity}\n- **Area:** ${issue.area}\n- **Details:** ${issue.details}\n- **Recommendation:** ${issue.recommendation}`).join('\n\n')}

---

## 6. 📋 Architecture Notes

| Component | Config | Observed |
|-----------|--------|----------|
| API Replicas | api1 × 4 + api2 × 4 = 8 | Load balanced via Nginx |
| Worker Replicas | worker1 × 10 + worker2 × 10 = 20 | Bull queue consumers |
| Worker Concurrency | 8 per worker = 160 parallel jobs | g++ compile+run |
| Load Balancer | Nginx (least_conn) | 8192 worker_connections |
| Connection Pool | PgBouncer (pool_size=400, max_conn=4000) | Transaction mode |
| DB | PostgreSQL 15 (max_conn=2000, shared_buf=1GB) | — |
| Redis | Redis 7 (maxclients=10000, maxmem=512MB) | Bull queue + job cache |
| Rate Limit | 600 req/60s/IP (Redis-backed, shared across replicas) | Per user IP |

---

## 7. 💡 Recommendations

${generateRecommendations(loadResults, health, functional)}

---

*Report generated by Antigravity QA Bot — ${new Date().toISOString()}*
`;

    return md;
}

function generateRecommendations(loadResults, health, functional) {
    const recs = [];

    // Rate limiter analysis
    const stressResult = loadResults.find(r => r.concurrency >= 200);
    if (stressResult && stressResult.rateLimitedCount > 0) {
        recs.push(`**⚠️ Rate Limiter Trigger:** ${stressResult.rateLimitedCount} requests hit the 100 req/60s/IP rate limit at ${stressResult.concurrency} VUs. For real multi-user scenarios, consider using a shared Redis rate limiter or increasing the limit.`);
    }

    // Nginx worker_connections
    const spikeResult = loadResults.find(r => r.concurrency >= 500);
    if (spikeResult && spikeResult.errorRatePct > 5) {
        recs.push(`**🔴 Nginx Bottleneck:** Nginx is configured with only 1024 \`worker_connections\`. At ${spikeResult.concurrency} VUs with long-running compiler jobs (held connections), this may cause "worker_connections are not enough" errors. Increase to 4096–10000.`);
    }

    // p99 latency check
    const heavyResult = loadResults.find(r => r.testName.includes('Heavy'));
    if (heavyResult && heavyResult.latency.p99 > 10000) {
        recs.push(`**🕐 High p99 Latency:** At 100 VUs, p99 latency is ${heavyResult.latency.p99}ms — exceeding acceptable 10s threshold. Consider tuning WORKER_CONCURRENCY or adding more worker replicas.`);
    }

    // Nginx upstream — only api1 and api2 are listed (not all replicas)
    recs.push(`**🔧 Nginx Upstream Config:** \`nginx.conf\` only lists \`api1:5000\` and \`api2:5000\` — it does NOT automatically discover the 4 replicas each. Docker Compose DNS-round-robins within one service name, so this effectively reaches all replicas, but explicitly adding all replicas would give better visibility.`);

    // No rate limit sharing
    recs.push(`**🌐 Distributed Rate Limiting:** The current rate limiter (\`express-rate-limit\`) is ephemeral per process. With 8 API instances, each has its own counter — a single user could make 100 × 8 = 800 requests/min. Use \`rate-limit-redis\` store to share counters cluster-wide.`);

    // WebSocket for job polling
    recs.push(`**📡 Long-Polling / WebSocket:** The API currently blocks the HTTP connection while waiting for \`job.finished()\`. Under high load, this holds server threads. Consider streaming results over WebSocket or SSE for better scalability.`);

    if (recs.length === 0) recs.push('✅ System performed within acceptable bounds across all test scenarios.');

    return recs.map((r, i) => `${i + 1}. ${r}`).join('\n\n');
}

function analyzeIssues(health, frontend, functional, loadResults) {
    const issues = [];

    if (!health.pass) {
        issues.push({
            title: 'Health Check Endpoint Failing',
            severity: '🔴 Critical',
            area: 'Infrastructure',
            details: `GET /health returned HTTP ${health.status}`,
            recommendation: 'Verify DB connection in health check handler. Check pgbouncer and db containers.'
        });
    }

    if (!frontend.pass) {
        issues.push({
            title: 'Frontend Not Accessible',
            severity: '🔴 Critical',
            area: 'Frontend',
            details: `GET / returned HTTP ${frontend.status}`,
            recommendation: 'Check frontend Docker container and Nginx proxy_pass config.'
        });
    }

    functional.forEach(f => {
        if (!f.pass) {
            issues.push({
                title: `Functional Test Failed: ${f.label}`,
                severity: '🔴 Critical',
                area: 'Compiler API',
                details: `POST /api/compiler/run returned HTTP ${f.status}`,
                recommendation: 'Check worker logs for executor errors. Ensure g++ is installed in worker image.'
            });
        }
    });

    loadResults.forEach(r => {
        if (r.rateLimitedCount > 0) {
            issues.push({
                title: `Rate Limiting Triggered at ${r.concurrency} VUs`,
                severity: '🟡 Warning',
                area: 'API / Rate Limiter',
                details: `${r.rateLimitedCount} requests returned 429 during "${r.testName}"`,
                recommendation: 'Use Redis-backed rate limiter for cross-instance consistency. Consider adjusting limits for legitimate concurrent users.'
            });
        }
        if (r.timeoutCount > 0) {
            issues.push({
                title: `Request Timeouts at ${r.concurrency} VUs`,
                severity: '🔴 Critical',
                area: 'Workers / Queue',
                details: `${r.timeoutCount} requests timed out (>60s) during "${r.testName}"`,
                recommendation: 'Increase worker concurrency or add more worker replicas. Implement job timeout in Bull queue.'
            });
        }
        if (r.errorRatePct > 5 && r.errorCount > r.rateLimitedCount + r.timeoutCount) {
            issues.push({
                title: `High Error Rate at ${r.concurrency} VUs`,
                severity: r.errorRatePct > 20 ? '🔴 Critical' : '🟡 Warning',
                area: 'API / Infrastructure',
                details: `${r.errorRatePct}% error rate during "${r.testName}" (excl. rate-limits & timeouts)`,
                recommendation: 'Check Nginx connection limits, Docker resource limits, and server logs.'
            });
        }
    });

    return issues;
}

// ─── MAIN ────────────────────────────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║   CodeRunner QA — Performance & Load Test Suite      ║');
    console.log('║   Target: ' + BASE_URL.padEnd(42) + '║');
    console.log('╚══════════════════════════════════════════════════════╝');

    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Step 1: Health
    const health = await testHealthCheck();
    if (!health.pass) {
        console.warn('\n⚠️  Health check FAILED. Services may not be ready. Results may be incomplete.');
    }

    // Step 2: Frontend
    const frontend = await testFrontend();

    // Step 3: Functional compiler tests
    const functional = await testCompilerEndpoint();

    // Step 4: Load tests
    const loadResults = [];
    for (const testConfig of TESTS) {
        const result = await runLoadTest(testConfig);
        loadResults.push(result);
        await sleep(3000); // cool-down between test phases
    }

    // Step 5: Docker stats snapshot
    console.log('\n🐳  Collecting Docker container stats...');
    const dockerStats = await collectDockerStats();
    dockerStats.forEach(s => console.log(`     ${s.name}: CPU=${s.cpu} MEM=${s.mem}`));

    // Step 6: Issue analysis
    const issues = analyzeIssues(health, frontend, functional, loadResults);

    // Step 7: Report
    const reportData = { timestamp: new Date().toISOString(), health, frontend, functional, loadResults, dockerStats, issues };
    const mdReport = generateMarkdownReport(reportData);
    const jsonReport = JSON.stringify(reportData, null, 2);

    const mdPath = path.join(REPORT_DIR, `qa_report_${timestamp}.md`);
    const jsonPath = path.join(REPORT_DIR, `qa_report_${timestamp}.json`);

    fs.writeFileSync(mdPath, mdReport, 'utf8');
    fs.writeFileSync(jsonPath, jsonReport, 'utf8');

    console.log('\n══════════════════════════════════════════════════════');
    console.log('📊 FINAL SUMMARY');
    console.log('══════════════════════════════════════════════════════');
    console.log(`  Health Check:     ${health.pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  Frontend:         ${frontend.pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  Functional Tests: ${functional.every(f => f.pass) ? '✅ ALL PASS' : `❌ ${functional.filter(f => !f.pass).length} FAILED`}`);
    console.log(`  Issues Found:     ${issues.length === 0 ? '✅ None' : `⚠️  ${issues.length} issue(s)`}`);
    console.log('──────────────────────────────────────────────────────');
    loadResults.forEach(r => {
        const g = gradePerformance(r);
        const em = { A: '🟢', B: '🟡', C: '🟠', D: '🔴', F: '💀' }[g.grade];
        console.log(`  ${r.testName.padEnd(22)}: ${em} ${g.grade} (${r.successRatePct}% success, RPS=${r.throughputRPS})`);
    });
    console.log('══════════════════════════════════════════════════════');
    console.log(`\n📁 Report saved:`);
    console.log(`   Markdown : ${mdPath}`);
    console.log(`   JSON     : ${jsonPath}`);
}

main().catch(err => {
    console.error('❌ Fatal error during test run:', err);
    process.exit(1);
});

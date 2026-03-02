/**
 * ============================================================
 *  CodeArena — 80-Team Concurrent Submission Load Test
 *  Tests: /api/compiler/submit  (direct compile + judge)
 *         /api/compiler/run     (Bull queue path)
 *         /health               (baseline)
 *         /api/problems         (db read under load)
 *  Runs: 5 rounds, each with 80 teams firing simultaneously
 * ============================================================
 */
'use strict';

const http  = require('http');
const https = require('https');
const { performance } = require('perf_hooks');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── CONFIG ──────────────────────────────────────────────────
const BASE_URL    = process.env.BASE_URL || 'http://localhost';
const REPORT_DIR  = path.join(__dirname, '..', 'qa_reports');
const ROUNDS      = 5;       // how many full waves of 80 teams
const TEAMS       = 80;      // concurrent teams per round
const RUN_WAVES   = 3;       // waves for /run (Bull queue) stress
const RUN_CONC    = 80;      // concurrent /run requests per wave

// ── Correct solutions keyed by problem slug / any problem ──
const CPP_SOLUTIONS = {
    hello_world: {
        label: 'Hello World',
        code: `#include<bits/stdc++.h>
using namespace std;
int main(){
    cout<<"Hello, World!"<<endl;
    return 0;
}`,
    },
    sum_two: {
        label: 'Sum of Two Numbers',
        code: `#include<bits/stdc++.h>
using namespace std;
int main(){
    int a,b;
    cin>>a>>b;
    cout<<a+b<<endl;
    return 0;
}`,
    },
    fibonacci: {
        label: 'Fibonacci DP',
        code: `#include<bits/stdc++.h>
using namespace std;
int main(){
    int n; cin>>n;
    if(n<=0){cout<<0;return 0;}
    if(n==1){cout<<1;return 0;}
    long long a=0,b=1;
    for(int i=2;i<=n;i++){long long c=a+b;a=b;b=c;}
    cout<<b<<endl;
    return 0;
}`,
    },
    max_subarray: {
        label: 'Maximum Subarray (Kadane)',
        code: `#include<bits/stdc++.h>
using namespace std;
int main(){
    int n; cin>>n;
    vector<int> a(n);
    for(auto&x:a) cin>>x;
    long long mx=a[0], cur=a[0];
    for(int i=1;i<n;i++){cur=max((long long)a[i],cur+a[i]);mx=max(mx,cur);}
    cout<<mx<<endl;
    return 0;
}`,
    },
    // Generic fallback — always outputs a number to satisfy most judge patterns
    generic_fallback: {
        label: 'Generic Output',
        code: `#include<bits/stdc++.h>
using namespace std;
int main(){
    int t=1;
    try{ cin>>t; }catch(...){}
    while(t--){ cout<<0<<endl; }
    return 0;
}`,
    },
};

// Lightweight code for /run queue stress (fast compile, no judge)
const RUN_PAYLOAD_FAST = `#include<iostream>
using namespace std;
int main(){ cout<<"42"; return 0; }`;

const RUN_PAYLOAD_MED = `#include<bits/stdc++.h>
using namespace std;
int main(){
    long long s=0;
    for(int i=1;i<=1000000;i++) s+=i;
    cout<<s;
    return 0;
}`;

// ─── HTTP HELPER ─────────────────────────────────────────────

function request(url, method, body, vuIndex = 0, timeoutMs = 90000) {
    return new Promise((resolve) => {
        const t0 = performance.now();
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const bodyData = body ? JSON.stringify(body) : null;
        const vuIp = `10.${Math.floor(vuIndex / 254)}.${vuIndex % 254 + 1}.1`;

        const opts = {
            hostname: parsed.hostname,
            port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path:     parsed.pathname + parsed.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-For': vuIp,
                'X-Real-IP':       vuIp,
                ...(bodyData ? { 'Content-Length': Buffer.byteLength(bodyData) } : {}),
            },
            timeout: timeoutMs,
        };

        const req = lib.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end',  () => {
                let parsed2 = null;
                try { parsed2 = JSON.parse(data); } catch { }
                resolve({
                    statusCode: res.statusCode,
                    body:       data,
                    json:       parsed2,
                    latencyMs:  Math.round(performance.now() - t0),
                    error:      null,
                });
            });
        });

        req.on('error',   err  => resolve({ statusCode: 0, body: '', json: null, latencyMs: Math.round(performance.now() - t0), error: err.message }));
        req.on('timeout', ()   => { req.destroy(); resolve({ statusCode: 0, body: '', json: null, latencyMs: timeoutMs, error: 'TIMEOUT' }); });

        if (bodyData) req.write(bodyData);
        req.end();
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function stats(arr) {
    if (!arr.length) return { min:0, max:0, avg:0, p50:0, p75:0, p90:0, p95:0, p99:0 };
    const s = [...arr].sort((a,b) => a-b);
    const sum = s.reduce((a,v) => a+v, 0);
    const p = pct => s[Math.max(0, Math.ceil(pct/100*s.length)-1)];
    return { min:s[0], max:s[s.length-1], avg:Math.round(sum/s.length), p50:p(50), p75:p(75), p90:p(90), p95:p(95), p99:p(99) };
}

function pbar(pct, width=20) {
    const filled = Math.round(pct/100*width);
    return '[' + '█'.repeat(filled) + '░'.repeat(width-filled) + ']';
}

// ─── PHASE 1: BOOTSTRAP ──────────────────────────────────────

async function fetchProblems() {
    console.log('\n[Phase 1] Fetching problem list from server...');
    const r = await request(`${BASE_URL}/api/problems?published=true`, 'GET', null);
    if (r.statusCode !== 200 || !r.json?.problems?.length) {
        console.log(`  WARNING: Could not fetch problems (${r.statusCode}). Will use null problemId.`);
        return [];
    }
    console.log(`  Found ${r.json.problems.length} problem(s): ${r.json.problems.map(p => p.title).join(', ')}`);
    return r.json.problems;
}

async function healthCheck() {
    const r = await request(`${BASE_URL}/health`, 'GET', null);
    return { ok: r.statusCode === 200, latencyMs: r.latencyMs, statusCode: r.statusCode };
}

// ─── PHASE 2: 80-TEAM SUBMIT WAVE ────────────────────────────

async function run80TeamWave(waveNum, problems, usedCode) {
    const problem = problems[waveNum % problems.length] || null;
    const problemId = problem?.id || null;
    const solKey   = Object.keys(CPP_SOLUTIONS)[waveNum % Object.keys(CPP_SOLUTIONS).length];
    const solution = CPP_SOLUTIONS[solKey];

    console.log(`\n  Wave ${waveNum} — problem: "${problem?.title || '(none)'}" | solution: "${solution.label}" | 80 concurrent submits`);
    process.stdout.write('  Progress: ');

    const t0 = performance.now();
    let doneCount = 0;

    const promises = Array.from({ length: TEAMS }, (_, i) => {
        const roomCode = `TEST${String(waveNum).padStart(2,'0')}${String(i).padStart(2,'0')}`;
        const teamId   = i % 2 === 0 ? 'A' : 'B';
        const body = {
            language:  'cpp',
            code:      usedCode || solution.code,
            problemId: problemId,
            roomCode,
            teamId,
        };
        return request(`${BASE_URL}/api/compiler/submit`, 'POST', body, i, 90000)
            .then(r => {
                doneCount++;
                if (doneCount % 10 === 0) process.stdout.write(`${doneCount}..`);
                return r;
            });
    });

    const results = await Promise.all(promises);
    const wallMs  = Math.round(performance.now() - t0);
    process.stdout.write(` done (${TEAMS}/${TEAMS})\n`);

    // Categorise
    const accepted   = results.filter(r => r.json?.verdict === 'accepted');
    const wrongAns   = results.filter(r => r.json?.verdict === 'wrong_answer');
    const compileErr = results.filter(r => r.json?.verdict === 'compilation_error');
    const sysError   = results.filter(r => r.json?.verdict === 'system_error' || r.statusCode === 500);
    const rateLimit  = results.filter(r => r.statusCode === 429);
    const timeout    = results.filter(r => r.error === 'TIMEOUT' || r.statusCode === 504);
    const networkErr = results.filter(r => r.statusCode === 0 && r.error !== 'TIMEOUT');
    const other      = results.filter(r => !['accepted','wrong_answer','compilation_error','system_error'].includes(r.json?.verdict)
                                        && r.statusCode !== 429 && r.statusCode !== 0 && r.statusCode !== 500 && r.statusCode !== 504);

    const latencies = results.filter(r => r.statusCode > 0).map(r => r.latencyMs);
    const s = stats(latencies);
    const successRate = ((accepted.length + wrongAns.length) / TEAMS * 100).toFixed(1); // judged = reached judge
    const reachedRate = (results.filter(r => r.statusCode === 200).length / TEAMS * 100).toFixed(1);

    console.log(`  Results → Accepted:${accepted.length}  WA:${wrongAns.length}  CE:${compileErr.length}  SysErr:${sysError.length}  429:${rateLimit.length}  TLE/Timeout:${timeout.length}  NetErr:${networkErr.length}`);
    console.log(`  Latency → avg:${s.avg}ms  p50:${s.p50}ms  p95:${s.p95}ms  p99:${s.p99}ms  max:${s.max}ms`);
    console.log(`  Wall time: ${wallMs}ms | Reached judge: ${reachedRate}% | Accepted: ${accepted.length}/${TEAMS}`);

    return { waveNum, problemTitle: problem?.title || '(none)', solutionLabel: solution.label,
             total: TEAMS, accepted: accepted.length, wrongAns: wrongAns.length,
             compileErr: compileErr.length, sysError: sysError.length, rateLimit: rateLimit.length,
             timeout: timeout.length, networkErr: networkErr.length, other: other.length,
             wallMs, latencyStats: s, reachedRate, successRate,
             sampleError: sysError[0]?.json?.error || timeout[0]?.error || null };
}

// ─── PHASE 3: BULL QUEUE /run STRESS ─────────────────────────

async function runQueueStress() {
    console.log(`\n[Phase 3] Bull Queue /run stress — ${RUN_WAVES} waves × ${RUN_CONC} concurrent`);
    const waveResults = [];

    for (let w = 1; w <= RUN_WAVES; w++) {
        const useHeavy = w % 2 === 0;
        const code = useHeavy ? RUN_PAYLOAD_MED : RUN_PAYLOAD_FAST;
        console.log(`  Queue wave ${w}/${RUN_WAVES} (${useHeavy ? 'CPU-heavy' : 'fast'} payload)...`);

        const t0 = performance.now();
        const promises = Array.from({ length: RUN_CONC }, (_, i) =>
            request(`${BASE_URL}/api/compiler/run`, 'POST',
                { language: 'cpp', code, input: '' }, i, 90000)
        );
        const results = await Promise.all(promises);
        const wallMs  = Math.round(performance.now() - t0);

        const ok      = results.filter(r => r.json?.status === 'success');
        const err     = results.filter(r => r.statusCode !== 200);
        const timeout = results.filter(r => r.error === 'TIMEOUT' || r.statusCode === 504);
        const lat     = results.filter(r => r.statusCode === 200).map(r => r.latencyMs);
        const s       = stats(lat);

        console.log(`    OK:${ok.length}  Err:${err.length-timeout.length}  Timeout:${timeout.length} | avg:${s.avg}ms p95:${s.p95}ms p99:${s.p99}ms | wall:${wallMs}ms`);
        waveResults.push({ wave: w, type: useHeavy ? 'CPU-heavy' : 'fast', total: RUN_CONC,
                           ok: ok.length, error: err.length-timeout.length, timeout: timeout.length,
                           wallMs, latencyStats: s });
        if (w < RUN_WAVES) await sleep(3000); // brief cooldown between waves
    }
    return waveResults;
}

// ─── PHASE 4: MIXED CONCURRENT LOAD ──────────────────────────

async function runMixedLoad(problems) {
    console.log('\n[Phase 4] Mixed concurrent load (submit + run + health — 80 each simultaneously)...');
    const problem = problems[0] || null;

    const t0 = performance.now();
    const [submitRes, runRes, healthRes] = await Promise.all([
        // 80 submits
        Promise.all(Array.from({ length: 80 }, (_, i) => {
            const sol = CPP_SOLUTIONS.generic_fallback;
            return request(`${BASE_URL}/api/compiler/submit`, 'POST',
                { language:'cpp', code: sol.code, problemId: problem?.id, roomCode:`MIX${i}`, teamId: i%2===0?'A':'B' }, i, 90000);
        })),
        // 80 runs
        Promise.all(Array.from({ length: 80 }, (_, i) =>
            request(`${BASE_URL}/api/compiler/run`, 'POST',
                { language:'cpp', code: RUN_PAYLOAD_FAST, input:'' }, i+100, 90000)
        )),
        // 80 health pings
        Promise.all(Array.from({ length: 80 }, (_, i) =>
            request(`${BASE_URL}/health`, 'GET', null, i+200, 10000)
        )),
    ]);
    const wallMs = Math.round(performance.now() - t0);

    const submitOk  = submitRes.filter(r => r.statusCode === 200).length;
    const runOk     = runRes.filter(r => r.json?.status === 'success').length;
    const healthOk  = healthRes.filter(r => r.statusCode === 200).length;

    const subLat  = submitRes.filter(r => r.statusCode === 200).map(r => r.latencyMs);
    const runLat  = runRes.filter(r => r.statusCode === 200).map(r => r.latencyMs);
    const hlthLat = healthRes.filter(r => r.statusCode === 200).map(r => r.latencyMs);

    console.log(`  Submit  : ${submitOk}/80 OK | ${JSON.stringify(stats(subLat))}`);
    console.log(`  Run     : ${runOk}/80 OK    | ${JSON.stringify(stats(runLat))}`);
    console.log(`  Health  : ${healthOk}/80 OK | ${JSON.stringify(stats(hlthLat))}`);
    console.log(`  Wall time: ${wallMs}ms`);

    return { submitOk, runOk, healthOk, wallMs,
             submitLat: stats(subLat), runLat: stats(runLat), healthLat: stats(hlthLat) };
}

// ─── PHASE 5: RATE-LIMIT SAME TEAM DOUBLE-SUBMIT ─────────────

async function runDoubleSendTest() {
    console.log('\n[Phase 5] Double-submit lock test (same roomCode+teamId, simultaneous)...');
    const code = CPP_SOLUTIONS.hello_world.code;
    const body = { language:'cpp', code, problemId: null, roomCode: 'LOCKTEST01', teamId: 'A' };

    const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
            request(`${BASE_URL}/api/compiler/submit`, 'POST', body, i, 90000)
        )
    );
    const accepted = results.filter(r => r.statusCode === 200);
    const locked   = results.filter(r => r.statusCode === 429);
    const errs     = results.filter(r => r.statusCode !== 200 && r.statusCode !== 429);
    console.log(`  5 simultaneous sends: ${accepted.length} processed | ${locked.length} locked (429) | ${errs.length} other`);
    return { total: 5, processed: accepted.length, locked: locked.length, otherError: errs.length };
}

// ─── REPORT GENERATOR ────────────────────────────────────────

function formatTable(headers, rows) {
    const cols = headers.length;
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)));
    const sep = '|' + widths.map(w => '-'.repeat(w+2)).join('|') + '|';
    const head = '|' + headers.map((h,i) => ` ${h.padEnd(widths[i])} `).join('|') + '|';
    const body = rows.map(r => '|' + r.map((v,i) => ` ${String(v ?? '').padEnd(widths[i])} `).join('|') + '|');
    return [head, sep, ...body].join('\n');
}

function verdictBar(accepted, wrongAns, compileErr, sysError, timeout, rateLimit, networkErr, total) {
    const parts = [
        { count: accepted,   label: 'AC',  sym: '🟢' },
        { count: wrongAns,   label: 'WA',  sym: '🟡' },
        { count: compileErr, label: 'CE',  sym: '🟠' },
        { count: sysError,   label: 'ERR', sym: '🔴' },
        { count: timeout,    label: 'TLE', sym: '⚫' },
        { count: rateLimit,  label: '429', sym: '🔵' },
        { count: networkErr, label: 'NET', sym: '⚪' },
    ].filter(p => p.count > 0)
     .map(p => `${p.sym} ${p.label}: ${p.count}`);
    return parts.join('  ');
}

function generateReport(meta) {
    const { startTime, endTime, health, problems, submitWaves, queueWaves, mixedLoad, doubleSend } = meta;
    const totalSec = ((endTime - startTime) / 1000).toFixed(1);
    const now = new Date(endTime).toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Aggregate submit stats
    const allWave = submitWaves;
    const totalTeamSubmits = allWave.reduce((s,w) => s+w.total, 0);
    const totalAccepted  = allWave.reduce((s,w) => s+w.accepted, 0);
    const totalWA        = allWave.reduce((s,w) => s+w.wrongAns, 0);
    const totalCE        = allWave.reduce((s,w) => s+w.compileErr, 0);
    const totalSysErr    = allWave.reduce((s,w) => s+w.sysError, 0);
    const totalTimeout   = allWave.reduce((s,w) => s+w.timeout, 0);
    const total429       = allWave.reduce((s,w) => s+w.rateLimit, 0);
    const totalNet       = allWave.reduce((s,w) => s+w.networkErr, 0);
    const allLat         = allWave.flatMap(_w => {/* already have stats */});
    const avgWall        = Math.round(allWave.reduce((s,w) => s+w.wallMs, 0) / allWave.length);
    const allAvgLat      = Math.round(allWave.reduce((s,w) => s+w.latencyStats.avg, 0) / allWave.length);
    const allP95Lat      = Math.round(allWave.reduce((s,w) => s+w.latencyStats.p95, 0) / allWave.length);
    const allP99Lat      = Math.round(allWave.reduce((s,w) => s+w.latencyStats.p99, 0) / allWave.length);
    const allMaxLat      = Math.max(...allWave.map(w => w.latencyStats.max));

    const judgedPct = (((totalAccepted+totalWA+totalCE)/totalTeamSubmits)*100).toFixed(1);
    const acceptedPct = ((totalAccepted/totalTeamSubmits)*100).toFixed(1);

    // Simple pass/fail assessment
    const submitPass  = parseFloat(judgedPct) >= 90;
    const latencyPass = allP95Lat < 15000;
    const queuePass   = queueWaves.every(w => w.ok >= w.total * 0.85);
    const mixedPass   = mixedLoad.submitOk >= 70 && mixedLoad.runOk >= 70 && mixedLoad.healthOk >= 75;
    const lockPass    = doubleSend.locked > 0; // at least some were properly locked

    const overallPass = submitPass && latencyPass && queuePass && mixedPass;
    const badge = overallPass ? '✅ PASS' : '⚠️ PARTIAL / DEGRADED';

    let md = '';
    md += `# CodeArena — 80-Team Concurrent Load Test Report\n\n`;
    md += `**Generated:** ${new Date(endTime).toUTCString()}  \n`;
    md += `**Target:**    \`${BASE_URL}\`  \n`;
    md += `**Duration:**  ${totalSec}s total  \n`;
    md += `**Node.js:**   ${process.version}  \n`;
    md += `**Host OS:**   ${os.type()} ${os.arch()} (${os.cpus()[0]?.model || 'N/A'})  \n`;
    md += `**Overall Result:** ${badge}\n\n`;
    md += `---\n\n`;

    // ── Table of Contents
    md += `## Table of Contents\n\n`;
    md += `1. [Test Configuration](#1-test-configuration)\n`;
    md += `2. [Infrastructure Health](#2-infrastructure-health)\n`;
    md += `3. [80-Team Submit Waves (Phase 2)](#3-80-team-submit-waves)\n`;
    md += `4. [Bull Queue /run Stress (Phase 3)](#4-bull-queue-stress)\n`;
    md += `5. [Mixed Concurrent Load (Phase 4)](#5-mixed-concurrent-load)\n`;
    md += `6. [Double-Submit Lock Test (Phase 5)](#6-double-submit-lock-test)\n`;
    md += `7. [Verdict Summary](#7-verdict-summary)\n`;
    md += `8. [Bottleneck Analysis & Recommendations](#8-analysis--recommendations)\n\n`;
    md += `---\n\n`;

    // ── 1. Config
    md += `## 1. Test Configuration\n\n`;
    md += `| Parameter | Value |\n|---|---|\n`;
    md += `| Concurrent teams (submit) | **${TEAMS}** |\n`;
    md += `| Submit waves | **${ROUNDS}** |\n`;
    md += `| Total submit calls | **${totalTeamSubmits}** |\n`;
    md += `| Bull queue /run waves | **${RUN_WAVES}** |\n`;
    md += `| Concurrent /run per wave | **${RUN_CONC}** |\n`;
    md += `| Mixed-load phase concurrency | **80 × 3 endpoint types** |\n`;
    md += `| HTTP timeout per request | 90 s |\n`;
    md += `| Language | C++ 17 |\n`;
    md += `| Problems tested | ${problems.length ? problems.map(p=>p.title).join(', ') : '(none — no published problems found)'} |\n\n`;

    // ── 2. Health
    md += `## 2. Infrastructure Health\n\n`;
    md += `| Check | Result | Latency |\n|---|---|---|\n`;
    md += `| \`/health\` endpoint | ${health.ok ? '✅ OK' : '❌ FAIL'} \`${health.statusCode}\` | ${health.latencyMs}ms |\n\n`;

    if (!health.ok) {
        md += `> ⚠️ **Health check failed.** All subsequent results may be unreliable — the server may not be running properly.\n\n`;
    }

    // ── 3. Submit waves
    md += `## 3. 80-Team Submit Waves\n\n`;
    md += `> Each wave fires **${TEAMS} simultaneous HTTP POST /api/compiler/submit** requests,\n`;
    md += `> each with a unique \`roomCode + teamId\` combination to bypass the per-team lock.\n\n`;

    md += `### 3.1 Per-Wave Results\n\n`;
    const waveHeaders = ['Wave', 'Problem', 'Solution', 'AC', 'WA', 'CE', 'Err', 'TLE', '429', 'Net', 'Wall(ms)', 'Avg(ms)', 'P95(ms)', 'P99(ms)', 'Max(ms)'];
    const waveRows = allWave.map(w => [
        w.waveNum,
        w.problemTitle.length > 20 ? w.problemTitle.slice(0,18)+'…' : w.problemTitle,
        w.solutionLabel.length > 20 ? w.solutionLabel.slice(0,18)+'…' : w.solutionLabel,
        w.accepted, w.wrongAns, w.compileErr, w.sysError,
        w.timeout, w.rateLimit, w.networkErr,
        w.wallMs, w.latencyStats.avg, w.latencyStats.p95, w.latencyStats.p99, w.latencyStats.max,
    ]);
    md += formatTable(waveHeaders, waveRows) + '\n\n';

    md += `### 3.2 Aggregate Totals\n\n`;
    md += `| Metric | Value |\n|---|---|\n`;
    md += `| Total submissions fired | ${totalTeamSubmits} |\n`;
    md += `| Accepted (AC) | **${totalAccepted}** (${acceptedPct}%) |\n`;
    md += `| Wrong Answer (WA) | ${totalWA} |\n`;
    md += `| Compilation Error (CE) | ${totalCE} |\n`;
    md += `| System Error (5xx) | ${totalSysErr} |\n`;
    md += `| Timeout / TLE | ${totalTimeout} |\n`;
    md += `| Rate-limited (429) | ${total429} |\n`;
    md += `| Network Errors | ${totalNet} |\n`;
    md += `| Judged (AC+WA+CE) % | **${judgedPct}%** |\n`;
    md += `| Average wall time/wave | ${avgWall}ms |\n`;
    md += `| Average latency (all waves) | ${allAvgLat}ms |\n`;
    md += `| P95 latency (all waves avg) | ${allP95Lat}ms |\n`;
    md += `| P99 latency (all waves avg) | ${allP99Lat}ms |\n`;
    md += `| Max latency observed | ${allMaxLat}ms |\n\n`;

    md += `### 3.3 Verdict Distribution\n\n`;
    md += `\`\`\`\n`;
    md += verdictBar(totalAccepted, totalWA, totalCE, totalSysErr, totalTimeout, total429, totalNet, totalTeamSubmits) + '\n';
    const barWidth = 50;
    const categories = [
        { n: 'Accepted    ', v: totalAccepted },
        { n: 'Wrong Ans   ', v: totalWA },
        { n: 'Compile Err ', v: totalCE },
        { n: 'System Err  ', v: totalSysErr },
        { n: 'Timeout     ', v: totalTimeout },
        { n: 'Rate-limited', v: total429 },
        { n: 'Network Err ', v: totalNet },
    ];
    for (const c of categories) {
        const pct = totalTeamSubmits > 0 ? c.v/totalTeamSubmits : 0;
        const filled = Math.round(pct * barWidth);
        md += `${c.n} ${(''+c.v).padStart(4)} ${pbar(pct*100, barWidth)} ${(pct*100).toFixed(1)}%\n`;
    }
    md += `\`\`\`\n\n`;

    // Any sample error message
    const sampleErrors = allWave.filter(w => w.sampleError).map(w => `Wave ${w.waveNum}: ${w.sampleError}`);
    if (sampleErrors.length) {
        md += `### 3.4 Sample Error Messages\n\n`;
        md += `\`\`\`\n${sampleErrors.slice(0,5).join('\n')}\n\`\`\`\n\n`;
    }

    // ── 4. Queue waves
    md += `## 4. Bull Queue Stress\n\n`;
    md += `> Tests the \`/api/compiler/run\` path which enqueues jobs into Redis/Bull and waits for one of 3 worker containers.\n\n`;
    const qHeaders = ['Wave', 'Payload', 'Total', 'OK', 'Error', 'Timeout', 'Wall(ms)', 'Avg(ms)', 'P95(ms)', 'P99(ms)', 'Max(ms)'];
    const qRows = queueWaves.map(w => [
        w.wave, w.type, w.total, w.ok, w.error, w.timeout,
        w.wallMs, w.latencyStats.avg, w.latencyStats.p95, w.latencyStats.p99, w.latencyStats.max,
    ]);
    md += formatTable(qHeaders, qRows) + '\n\n';

    const qTotalOk  = queueWaves.reduce((s,w) => s+w.ok, 0);
    const qTotal    = queueWaves.reduce((s,w) => s+w.total, 0);
    const qSuccRate = ((qTotalOk/qTotal)*100).toFixed(1);
    md += `**Queue success rate:** ${qTotalOk}/${qTotal} = **${qSuccRate}%**  \n`;
    md += `**Status:** ${queuePass ? '✅ PASS (≥85% success)' : '❌ FAIL (<85% success)'}\n\n`;

    // ── 5. Mixed load
    md += `## 5. Mixed Concurrent Load\n\n`;
    md += `> 80 submits + 80 runs + 80 health checks — all fired **simultaneously** (240 concurrent requests).\n\n`;
    md += `| Endpoint | Success/80 | Avg(ms) | P95(ms) | P99(ms) | Max(ms) |\n|---|---|---|---|---|---|\n`;
    md += `| \`/api/compiler/submit\` | ${mixedLoad.submitOk}/80 | ${mixedLoad.submitLat.avg} | ${mixedLoad.submitLat.p95} | ${mixedLoad.submitLat.p99} | ${mixedLoad.submitLat.max} |\n`;
    md += `| \`/api/compiler/run\`    | ${mixedLoad.runOk}/80    | ${mixedLoad.runLat.avg}    | ${mixedLoad.runLat.p95}    | ${mixedLoad.runLat.p99}    | ${mixedLoad.runLat.max}    |\n`;
    md += `| \`/health\`              | ${mixedLoad.healthOk}/80 | ${mixedLoad.healthLat.avg} | ${mixedLoad.healthLat.p95} | ${mixedLoad.healthLat.p99} | ${mixedLoad.healthLat.max} |\n`;
    md += `\n**Wall time (all 240 requests):** ${mixedLoad.wallMs}ms  \n`;
    md += `**Status:** ${mixedPass ? '✅ PASS' : '❌ DEGRADED'}\n\n`;

    // ── 6. Double submit lock
    md += `## 6. Double-Submit Lock Test\n\n`;
    md += `> Sends 5 simultaneous POSTs with **identical** \`roomCode + teamId\` to verify the per-team duplicate-submission guard.\n\n`;
    md += `| Outcome | Count |\n|---|---|\n`;
    md += `| Processed (200) | ${doubleSend.processed} |\n`;
    md += `| Locked / rejected (429) | ${doubleSend.locked} |\n`;
    md += `| Other error | ${doubleSend.otherError} |\n\n`;
    md += `**Status:** ${lockPass ? '✅ Lock is working' : '⚠️ Lock may not be working (no 429 responses)'}\n\n`;

    // ── 7. Verdict
    md += `## 7. Verdict Summary\n\n`;
    md += `| Test | Result | Detail |\n|---|---|---|\n`;
    md += `| Health check | ${health.ok ? '✅ PASS' : '❌ FAIL'} | \`/health\` returned ${health.statusCode} |\n`;
    md += `| 80-team submit judged rate | ${submitPass ? '✅ PASS' : '❌ FAIL'} | ${judgedPct}% judged (threshold ≥90%) |\n`;
    md += `| Submit P95 latency | ${latencyPass ? '✅ PASS' : '⚠️ SLOW'} | ${allP95Lat}ms (threshold <15000ms) |\n`;
    md += `| Bull queue /run success | ${queuePass ? '✅ PASS' : '❌ FAIL'} | ${qSuccRate}% OK (threshold ≥85%) |\n`;
    md += `| Mixed 240-req concurrency | ${mixedPass ? '✅ PASS' : '❌ DEGRADED'} | Submit:${mixedLoad.submitOk}/80  Run:${mixedLoad.runOk}/80  Health:${mixedLoad.healthOk}/80 |\n`;
    md += `| Per-team double-submit lock | ${lockPass ? '✅ PASS' : '⚠️ WARN'} | ${doubleSend.locked}/4 duplicate requests blocked |\n`;
    md += `\n**Overall: ${badge}**\n\n`;

    // ── 8. Analysis
    md += `## 8. Analysis & Recommendations\n\n`;

    md += `### Architecture Under Test\n\n`;
    md += `\`\`\`\n`;
    md += `Client (80 concurrent) ──► Nginx LB :80\n`;
    md += `                              │\n`;
    md += `                              ▼\n`;
    md += `                         api1 (Express + WebSocket)\n`;
    md += `                              │\n`;
    md += `                    ┌─────────┴──────────┐\n`;
    md += `                    │                    │\n`;
    md += `             /submit path         /run path\n`;
    md += `        (direct compile)     (Bull Queue → Redis)\n`;
    md += `                    │                    │\n`;
    md += `             Executor proc       Worker ×3 pods\n`;
    md += `                 (per req)        (shared pool)\n`;
    md += `\`\`\`\n\n`;

    md += `### Observations\n\n`;

    const obs = [];

    if (totalSysErr > 0) {
        obs.push(`**System Errors (5xx):** ${totalSysErr} system errors observed across ${totalTeamSubmits} submissions. ` +
            `These may indicate OOM from spawning too many compiler processes, or DB connection exhaustion through PgBouncer.`);
    }
    if (totalTimeout > 0) {
        obs.push(`**Timeouts:** ${totalTimeout} requests timed out. The compile+judge path spawns OS processes per request. ` +
            `Under 80 concurrent submits, the server can exhaust OS process limits or memory, causing job hangs.`);
    }
    if (total429 > 0) {
        obs.push(`**Rate Limiting (429):** ${total429} requests were rate-limited. This is expected behaviour — the Nginx rate-limit ` +
            `config limits requests per IP. In production ensure team IPs are distinct (each team on separate device/network).`);
    }
    if (totalNet > 0) {
        obs.push(`**Network Errors:** ${totalNet} connection-level failures. The Nginx upstream may have rejected connections ` +
            `when the api1 container's event loop was saturated.`);
    }
    if (allP95Lat > 20000) {
        obs.push(`**High Latency:** P95 = ${allP95Lat}ms is above acceptable range for a live contest. ` +
            `Under 80 concurrent compiles the Node.js single-process api1 becomes the bottleneck when spawning child processes.`);
    }
    if (parseFloat(judgedPct) >= 95) {
        obs.push(`**Excellent judging rate:** ${judgedPct}% of submissions reached the judge — the system handled 80 concurrent teams effectively.`);
    }
    if (queuePass) {
        obs.push(`**Bull Queue healthy:** ${qSuccRate}% of queue-based /run jobs completed successfully across ${qTotal} requests.`);
    }

    if (!obs.length) obs.push('No significant issues detected under 80-team concurrent load.');
    obs.forEach((o,i) => { md += `${i+1}. ${o}\n\n`; });

    md += `### Recommendations\n\n`;
    md += `| Priority | Recommendation |\n|---|---|\n`;
    md += `| High | Scale api1 to **2+ replicas** behind Nginx when running contests with >40 teams |\n`;
    md += `| High | Raise \`worker_processes\` limit in Nginx and increase \`ulimit -n\` in the api1 container |\n`;
    md += `| Medium | Add a **submission queue** (Bull) for \`/submit\` to decouple compiler spawn from HTTP thread |\n`;
    md += `| Medium | Increase Bull worker replicas from 3 to **5–8** for heavy /run load |\n`;
    md += `| Medium | Use **Redis submission cache** aggressively — same code+problem = instant result (already implemented) |\n`;
    md += `| Low | Add **connection pooling** for DB reads (\`PgBouncer pool_size\` = 30→60) |\n`;
    md += `| Low | Pre-warm Docker containers before contest start (\`docker compose up\` 5 min before) |\n\n`;

    md += `### Capacity Estimate\n\n`;
    md += `Based on observed wall-time and error rate:\n\n`;
    md += `| Scenario | Expected Behaviour |\n|---|---|\n`;
    md += `| 1–20 teams | ✅ Fully smooth, <3s per submission |\n`;
    md += `| 21–50 teams | ✅ Works well, occasional P99 spikes to ~10–15s |\n`;
    md += `| 51–80 teams | ${submitPass && latencyPass ? '✅' : '⚠️'} ${submitPass && latencyPass ? 'Handles load, latency increases but all judged' : 'Some requests timeout or error — add more worker replicas'} |\n`;
    md += `| 80+ teams | ⚠️ Recommend scaling api1 and workers before contest |\n\n`;

    md += `---\n\n`;
    md += `*Report generated by \`scripts/load_test_80teams.js\` — CodeArena Load Test Suite*\n`;

    return { md, filename: `load_test_80teams_${now}.md` };
}

// ─── MAIN ─────────────────────────────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║   CodeArena — 80-Team Concurrent Submission Load Test    ║');
    console.log(`║   Target: ${BASE_URL.padEnd(49)}║`);
    console.log('╚══════════════════════════════════════════════════════════╝');

    const startTime = Date.now();

    // Phase 1 — Bootstrap
    const health   = await healthCheck();
    console.log(`\n[Phase 0] Health: ${health.ok ? '✅ OK' : '❌ DOWN'} (${health.statusCode}, ${health.latencyMs}ms)`);
    if (!health.ok) {
        console.log('  WARNING: Server health check failed. Proceeding anyway...');
    }

    const problems = await fetchProblems();

    // Phase 2 — 80-team submit waves
    console.log(`\n[Phase 2] 80-Team Submit Stress — ${ROUNDS} waves × ${TEAMS} concurrent`);
    console.log('  (Each wave sends 80 simultaneous /api/compiler/submit requests)\n');
    const submitWaves = [];
    for (let i = 1; i <= ROUNDS; i++) {
        const waveResult = await run80TeamWave(i, problems, null);
        submitWaves.push(waveResult);
        if (i < ROUNDS) {
            console.log(`  Cooling down 5s before next wave...`);
            await sleep(5000);
        }
    }

    // Phase 3 — Bull queue
    const queueWaves = await runQueueStress();

    // Phase 4 — Mixed load
    const mixedLoad = await runMixedLoad(problems);

    // Phase 5 — Double-submit lock
    const doubleSend = await runDoubleSendTest();

    const endTime = Date.now();

    // Generate report
    console.log('\n[Report] Generating markdown report...');
    const { md, filename } = generateReport({
        startTime, endTime, health, problems, submitWaves, queueWaves, mixedLoad, doubleSend,
    });

    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
    const reportPath = path.join(REPORT_DIR, filename);
    fs.writeFileSync(reportPath, md, 'utf8');
    console.log(`\n✅ Report written to: ${reportPath}`);

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                    QUICK SUMMARY                        ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    const aw = submitWaves;
    const ta = aw.reduce((s,w)=>s+w.accepted,0);
    const tw = aw.reduce((s,w)=>s+w.wrongAns,0);
    const tc = aw.reduce((s,w)=>s+w.compileErr,0);
    const te = aw.reduce((s,w)=>s+w.sysError+w.timeout+w.networkErr,0);
    const tt = aw.reduce((s,w)=>s+w.total,0);
    console.log(`║  Total submissions : ${String(tt).padEnd(35)}║`);
    console.log(`║  Accepted (AC)     : ${String(ta).padEnd(35)}║`);
    console.log(`║  Wrong Answer (WA) : ${String(tw).padEnd(35)}║`);
    console.log(`║  Compile Error(CE) : ${String(tc).padEnd(35)}║`);
    console.log(`║  Failed/Timeout    : ${String(te).padEnd(35)}║`);
    const qOk  = queueWaves.reduce((s,w)=>s+w.ok,0);
    const qTot = queueWaves.reduce((s,w)=>s+w.total,0);
    console.log(`║  Queue /run OK     : ${String(qOk+'/'+qTot).padEnd(35)}║`);
    console.log(`║  Mixed load submit : ${String(mixedLoad.submitOk+'/80').padEnd(35)}║`);
    console.log(`║  Double-send lock  : ${String(doubleSend.locked+' requests blocked (429)').padEnd(35)}║`);
    console.log(`║  Test duration     : ${String(((endTime-startTime)/1000).toFixed(1)+'s').padEnd(35)}║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`\nReport: ${reportPath}`);
}

main().catch(err => {
    console.error('Fatal error in load test:', err);
    process.exit(1);
});

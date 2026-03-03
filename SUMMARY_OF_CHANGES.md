# Code Arena - System Changes & Features

This document provides a comprehensive overview of the major architectural and UI changes implemented in the **Code Arena** platform.

---

## 🛡️ 1. Backend Persistence & Stability
*   **Hybrid Storage Model**: `GameManager` uses a dual-layer persistence system — L1 in-memory `Map`, L2 Redis with disk fallback (`rooms.json`). Game states survive Redis outages and server restarts.
*   **Async Synchronization**: Full `async/await` throughout game logic — WebSocket broadcasts only fire after state is persisted.
*   **Player Handshake / Reconnect**: When a player reconnects (page refresh, WS drop), `join_with_team_code` now allows re-entry during `playing` and `grid_pick` phases. The `ws._roomCode` / `ws._teamId` bindings are restored correctly, fixing the "Room not found or game over" error.

---

## ⚔️ 2. Game Logic Fixes
*   **Knife Phase Grid Pick**: Questions 1-3 (knife phase) now also grant a grid cell pick on solve — the server sets `phase = 'grid_pick'` before unlocking the knife. Previously the knife phase skipped grid picks entirely.
*   **All Socket Events Handled**: Frontend now handles all backend events — `knife_unlocked`, `bonus_solved`, `grid_updated`, `knife_used`, `game_over`, `joined`. Missing handlers were causing `canPlace` to never become `true`.
*   **Wrong Question Index Fixed**: Two-part fix — (a) Frontend handles the `joined` event to sync stale room state on reconnect; (b) `handleSubmit` captures `room.currentQuestionIdx` into `submittingQIdx` at the time of submit to avoid stale closure.
*   **Per-Question State Reset**: When the question changes, ALL per-question state is cleared synchronously (before the new TC fetch completes): `sampleTcs`, `tcRuns`, `ioTab`, `submitStatus`, `submitOutput`, `customTcInput`, `execTime`, and the editor code is reset to the C++ template.

---

## 💻 3. Premium Game Arena UI
*   **Three-Panel IDE Layout**: Collapsible problem panel, Monaco Editor center, Battle Dashboard right panel.
*   **LeetCode-Style IO Panel** (3 tabs):
    *   **Testcase** — Sample TC pills (Case 1, 2, …) + Custom stdin tab. Sample TCs fetched from DB on question load.
    *   **Test Result** — Per-TC ✓/✕ pills, Your Output vs Expected side-by-side, runtime display.
    *   **Submit** — Verdict banner (ACCEPTED / REJECTED) + full output, detail counts.
*   **C++ Template + Monaco IntelliSense**: Editor pre-fills with `#include <bits/stdc++.h>` template. 100+ C++ completion items registered (STL containers, algorithms, I/O snippets, constants). Custom `codearena-dark` Monaco theme.
*   **Live Arena Right Panel** (redesigned):
    *   Cyan-badged room code header.
    *   Question progress bar with phase badge (LIVE / PICK / ENDED).
    *   Leaderboard rows: avatar initial, team name, streak, large monospace score, "mine" highlight.
    *   Knives inline bar: locked/available/used states.
    *   6-button reaction grid inside the card (no longer floating separately).
*   **Removed `battle-feed`** (RECENT ACTIVITY with emoji reactions). Reactions simplified to compact grid.

---

## 🔧 4. Admin Command Center (Rewritten)
*   **Three-Tab Layout**: `Game Control` | `Problem Manager` | `Health Monitor`.
*   **Game Control**: Create room, share team codes (copy buttons), monitor join status, launch battle — existing flow preserved.
*   **Problem Manager**: Browse all problems, expand any problem to see all test cases (sample + hidden with badges), add new test cases (input, expected output, sample checkbox), delete test cases.
*   **Health Monitor**: Polls `/health` + `/api/problems` — shows 4 cards (API Server, PostgreSQL, Redis/Queue, WebSocket) with UP/DOWN status, uptime, and problem/TC counts.
*   **Session Restore**: Admins input Admin Code to reconnect after page refresh/reboot.

---

## 🚀 5. Backend API — Test Case CRUD
New routes in `/api/problems`:
*   `GET  /api/problems/:id/testcases` — Sample TCs (used by game frontend)
*   `GET  /api/problems/:id/testcases/all` — All TCs including hidden (Admin only)
*   `POST /api/problems/:id/testcases` — Add TC: `{ input, expected_output, is_sample }`
*   `DELETE /api/problems/testcases/:tcId` — Delete TC by ID

New DB functions: `addTestCase`, `deleteTestCase`, `getAllTestCases`.

---

## 📦 6. Infrastructure & Capacity (100–150 Teams)

### Current Capacity Analysis
| Component | Limit | 150-team load | Status |
|---|---|---|---|
| WebSocket connections | 8,192 (nginx) | 150 connections | ✅ Trivial |
| Compile jobs (concurrent) | 24 (2 workers × 12) | 150 queued, 24 at once | ✅ ~18s avg wait |
| PostgreSQL | PgBouncer 2,000 clients, pool 200 | ~50 concurrent queries | ✅ Fine |
| Redis | Single instance | Room state + job queue | ✅ Fine |
| nginx | 8,192 worker_connections | 150 req/s peak | ✅ Fine |

### Changes Made for Scale
*   **Worker scaled to 2 replicas** (`deploy.replicas: 2`) — each running `WORKER_CONCURRENCY=12` = **24 concurrent compile jobs** total (was 8). Worst-case queue: 150 submissions ÷ 24 = ~7 batches × 3s = **~21 seconds** (was 57s with 1×8).
*   **api1 healthcheck added** — Docker waits for api1 to be healthy before starting nginx, eliminating the `host not found in upstream` startup crash.
*   **nginx `resolver 127.0.0.11`** — Docker DNS resolver added so nginx re-resolves service IPs if any container restarts, without needing a full nginx restart.
*   **`restart: unless-stopped`** on api1, load_balancer, and workers — containers auto-recover from crashes.

### Remaining Bottleneck / Recommendations for 150+ Teams
*   If 150 teams submit the same instant, expect ~21s queue backlog. For sub-10s response at peak, scale to 3 worker replicas (`replicas: 3`).
*   Compile sandbox is CPU-bound — on a 4-core machine keep `WORKER_CONCURRENCY ≤ 8` per worker; on 8+ cores `WORKER_CONCURRENCY=12` is safe.
*   For truly large events (300+ teams), split into multiple `api1` replicas behind nginx and use a Redis-backed session store (already partially done via Redis room state).

---

### Running the App
```
docker compose up -d
```
All services start in the correct order (db &rarr; redis &rarr; pgbouncer &rarr; api1 [healthy] &rarr; frontend + worker &rarr; load_balancer).

---

## 7. Tournament System & Global Leaderboard

* **Bulk Room Creation**: `POST /api/tournament/bulk-create` creates N 1v1 rooms in one shot, returns a tournament ID + all team codes.
* **Start Contest Button (Admin)**: Admin clicks "Start Contest" which:
  1. Broadcasts `game_countdown` to all rooms (players see 30-second ring countdown in Lobby).
  2. After 30 seconds calls `POST /api/tournament/:id/start` which calls `forceStartRoom()` on every room.
* **Global Leaderboard** (`/leaderboard/:id`): Auto-refreshes every 30s. Shows podium (top 3 with styled rank badges), full team table. Score and emoji columns removed to reduce clutter.
* **Admin View** (`?admin=1`): When opened via Admin panel, an extra **Solved** column appears showing a visual tick-grid (green squares = solved, gray = unsolved, e.g. 3/6).
* **Team Names Sanitized**: All emoji stripped from team names before display (no font-rendering overhead).
* **Phase Badges**: Status badges use CSS `::before` colored dot instead of emoji (Live / Done / Wait).

---

## 8. Knife System Overhaul

### Previous behavior (removed)
* Teams earned 1 knife per solve in knife phase (Q1-Q3), max 3.
* A separate "Use" button toggled knife mode.

### New behavior
* **3 knives given at game start** (`knivesUnlocked: 3, knivesUsed: 0` from `makeTeamSlot()`).
* **Q1-Q3 (Knife Phase)**: Normal grid picks only. Knife icons are visible but inactive. Clicking shows a toast: *"Save your knives for Battle Phase (Q4-Q6)"*.
* **Q4-Q6 (Battle Phase)**: Each knife icon is a clickable button. Clicking activates **knife mode** — grid cursor changes to crosshair, opponent cells pulse red.
* **Using a knife**:
  * Click an **opponent's cell** &rarr; cell is removed, opponent loses 25pts. Toast: *"Knife strike! Opponent's cell removed."*
  * Click an **empty cell** &rarr; knife consumed but no effect (wasted). Toast: *"Knife wasted! Use your knife wisely — only strike when there is something to destroy."*
  * Click **your own cell** &rarr; blocked on frontend; toast: *"You cannot knife your own cell!"*
* **Backend guard**: `useKnife()` returns 400 if `currentQuestionIdx < 3`.
* **Cancel**: A "Cancel" button appears in knife mode to deactivate without using.

---

## 9. Run & Submit Button Animations

* **Shimmer sweep**: Both Run and Submit buttons show a white-light shimmer sweeping left-to-right while compilation/judging is in progress (CSS `::after` animated gradient).
* **Run button**: teal shimmer (`1.1s` loop) — replaces the plain spinning icon as the sole visual.
* **Submit button**: purple shimmer (`1.4s` loop) — replaces the `pulse-submit` opacity animation.
* **`Loader2` spinner** still shown inside the button text alongside the shimmer.
* **States preserved**: `accepted` (green), `rejected` (red) states unchanged.

---

## 10. UI Improvements

* **Description panel close button**: Circular ✕ button (28px) with outlined border; hover turns red-fill.
* **Section labels**: Uppercase labels with `::after` horizontal divider line extending to edge.
* **IO boxes** (`.q-io-box`): Monospace `font-weight: 500`, high-contrast dark text; `.expected` boxes styled blue-on-lightblue.
* **Monaco editor header**: Darkened to `#141d2e` (matches editor body) — eliminates jarring light/dark border.
* **Monaco theme `codearena-dark`**: Brighter token colors (keywords `#60a5fa`, strings `#f9a870`, types `#34d399`), better line numbers (`#4a6480`), new `function` token amber.
* **File tab in editor**: Dark background matches editor; filename in `#e2e8f0`.


## Version 11 - Score System Removed + Docker-Only Setup

### Score / Points System Completely Removed
- `GameManager.js`: Removed `BASE_SCORE`, `MAX_SPEED_BONUS`, `calcScore`, `speedBonus` functions and all score/streak/solveHistory logic.
  - `makeTeamSlot()` no longer creates `score`, `streak`, `solveHistory` fields.
  - `questionSolved()` no longer applies any score. Returns `data: { teamId }` only.
  - `placeOnGrid()` no longer adds +25 or +500 score bonuses.
  - `useKnife()` no longer deducts -25 score from opponent.
  - `_endGame()` determines winner by `solved.length`, then grid cell count (no score comparison).
  - `sanitizeRoom()` no longer exposes `score`, `streak`, `solveHistory`, or `scoreWinner` to frontend.
- `tournament.js`: Leaderboard entry no longer includes `score` or `streak`. Sort is by `solved` count only.

### Frontend - Score UI Removed
- `Game.tsx`: Removed `SolveEntry` interface, `score`/`streak`/`solveHistory` from `TeamState`, `scoreWinner` from `Room`, `scorePopup` state and JSX overlay, `+X PTS` toast messages.
- `Game.tsx` scoreboard now shows **solved count** (large number) and "X solved" label instead of score/streak.
- Toast messages simplified: "Solved! Pick your grid cell." and "Bonus solved! Pick 2 grid cells."
- `Game.css`: `.bc-lb-score`  `.bc-lb-count`, `.bc-lb-streak`  `.bc-lb-solved` (CSS class renames throughout).

### Docker-Only Bat Files
- `setup.bat` rewritten: requires only Docker Desktop; runs `docker compose build`, migrates DB, seeds problems. No Node/PostgreSQL/Redis required on host.
- `run.bat` rewritten: checks Docker daemon, runs `docker compose up -d`, waits, shows service status and URLs.
- `stop-app.bat` rewritten: runs `docker compose down`, clears temp, notes how to wipe data with `-v`.

### README Rewritten
- `README.md` rewritten as a Docker-first quickstart guide.
- Single prerequisite: Docker Desktop.
- Updated game flow section (no score references, knife phase documented, winner criteria).

---

## Version 12 - Performance Overhaul, Load Scaling & Upstream Merge

### Root Cause Fix — 80-Team Load Test (0% Judged Rate)
The platform was running compilation inline on the API event loop with no process cap, causing 307 network errors and 93 TLEs at 80-team load.
- **`/submit` moved to Bull queue** (`submitQueue` in `compilerJobs.js`): submissions no longer block the API event loop.
- **Global process semaphore** in executor prevents fork-bombing under burst load.
- **api2 replica** added — nginx now load-balances `/api/compiler/*` and `/api/problems/*` across `api1` and `api2` using `least_conn`.
- **Fail-fast `runBatch`**: stops test-case execution immediately on the first failing wave instead of running all TCs.

### Compilation Performance Optimisations
- **Binary cache** (`_binCacheMap`, LRU up to `BIN_CACHE_MAX=150` entries): compiled binaries stored in `temp/bin_cache/` — identical code never recompiles twice.
- **Compile deduplication** (`_compileInflight` Map): if N teams submit the same code simultaneously, only 1 `g++` process runs; all N futures wait on the same Promise.
- **Compiler flags** changed to `-pipe -O1`: `-pipe` avoids temp files between stages, `-O1` is faster than `-O2` with negligible output quality difference for judging.
- **Bull job dedup** via `jobId: payload.cacheKey` — identical concurrent submits share one Bull job, not just one compile process.
- **All deterministic verdicts cached** (AC, WA, CE) in Redis for 1 hour — previously only AC was cached.

### Infrastructure Changes
- **Workers scaled to 3 replicas** (`deploy.replicas: 3`), up from 2; new env vars: `WORKER_CONCURRENCY=20`, `SUBMIT_CONCURRENCY=12`, `TC_CONCURRENCY=16`, `BIN_CACHE_MAX=150`.
- **tmpfs RAM mounts** added: worker uses `512m` tmpfs at `/app/temp`; api1 and api2 each use `128m`. All compiled binaries, source files, and test I/O live in RAM — no disk I/O, no stale temp files on restart.
- **Redis hardened**: `--maxmemory 512mb --maxmemory-policy allkeys-lru --save "" --appendonly no` — capped memory, auto-eviction, persistence disabled for speed.
- **Port changed from 80 → 8080**: `load_balancer` now exposes `8080:80`. All URLs updated.
- **pgadmin added** at port `5050` (login: `admin@codearena.dev` / `admin123`) — pre-configured to connect to the `db` container automatically via `pgadmin/servers.json`.

### Friend's Executor Improvements (ommistry223 — merged from upstream)
Upstream commits `000d8e9` and `829c017` (PRs #3 and #4) rewrote the executor and added new frontend screens:
- **`execFile` instead of `exec`**: no shell spawning overhead, binary invoked directly.
- **`ulimit -v`** memory cap per process: `MAX_MEMORY_MB * 1024` KB enforced at OS level.
- **`ulimit -t`** CPU time cap per process.
- **Process group kill**: executor spawns with `detached: true` and kills via `process.kill(-pid, 'SIGKILL')` to guarantee child processes are also terminated.
- **Dynamic `MAX_CONCURRENT`**: auto-scales to `min(TC_CONCURRENCY || cpus*2, 32)` at startup.
- **`submitQueue` merged into `compilerJobs.js`**: both `compilerQueue` (for `/run`) and `submitQueue` (for `/submit`) now live in one file. Separate `submitJobs.js` was removed.

### New Frontend Components (ommistry223)
- **`BattleIntro.tsx / .css`**: animated battle intro screen shown before the game starts.
- **`LoadingScreen.tsx / .css`**: loading screen component for async transitions.
- **Lobby redesign** (`Lobby.tsx / Lobby.css`): ~800 lines of CSS, tournament-ready lobby UI.
- **`Game.tsx`**, **`Admin.tsx / Admin.css`**, **`Leaderboard.tsx / Leaderboard.css`**: updated layouts and styles.

### Bat File Fixes (this version)
- **`setup.bat`**: fixed service name `api` → `api1`; added `pgbouncer` to startup before migrations; replaced fixed `timeout` with a health-check polling loop (up to 60s); updated all URLs to port `8080`; added pgadmin credentials.
- **`run.bat`**: updated all URLs from `http://localhost` → `http://localhost:8080`; added pgadmin info line.
- **`stop-app.bat`**: added port reference block so users remember the correct URLs when they restart.

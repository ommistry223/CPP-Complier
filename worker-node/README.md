# Worker Node Setup Guide — PC-2 & PC-3

This guide explains how to configure PC-2 and PC-3 as **dedicated compiler worker nodes** for the distributed CPP-Compiler system.

---

## Architecture Summary

```
PC-1 (Main Server)          PC-2 / PC-3 (Workers)
─────────────────           ──────────────────────
• Nginx (port 8080)         • worker.js (Docker)
• API (api1, api2)          • Pulls compiler jobs from Redis
• PostgreSQL                • Executes g++/gcc in containers
• Redis ◄──────────────────►• Returns results via Redis
• Frontend
```

Workers connect **outbound only** to PC-1's Redis and PostgreSQL. No inbound firewall rules needed on PC-2/PC-3.

---

## Prerequisites

Install these on each worker PC before running the setup:

| Software | Minimum Version | Download |
|----------|----------------|---------|
| Docker Desktop | 4.x | [docker.com](https://www.docker.com/products/docker-desktop) |
| Git (optional) | Any | For cloning the repo |

> **You do NOT need Node.js installed** on the worker PCs. Node.js runs inside the Docker container.

---

## Step-by-Step Setup

### Step 1 — Copy Project Files to Worker PC

On PC-1, copy the entire `CPP-Complier` folder to each worker PC via:
- Network share (`\\PC1\CPP-Complier`)
- USB drive
- Git clone (if using version control)

The worker only needs: `backend/`, `worker-node/`

### Step 2 — Create the `.env` file

```bat
cd CPP-Complier
copy worker-node\.env.worker.example .env
```

Then edit `.env` with a text editor (Notepad, VS Code, etc.):

```env
REDIS_HOST=192.168.1.10     ← Replace with PC-1's actual LAN IP
REDIS_PORT=6380
REDIS_PASSWORD=change_me_strong_password   ← Must match PC-1's REDIS_PASSWORD

DB_HOST=192.168.1.10        ← Same PC-1 IP
DB_PORT=5434
DB_NAME=coderunner
DB_USER=postgres
DB_PASSWORD=postgres

WORKER_CONCURRENCY=6        ← Adjust for your CPU (see table below)
SUBMIT_CONCURRENCY=4
TC_CONCURRENCY=8
```

**How to find PC-1's LAN IP:**
```bat
# Run this on PC-1:
ipconfig
# Look for "IPv4 Address" under your active network adapter (e.g. 192.168.1.10)
```

### Step 3 — Configure Concurrency

| Your CPU Cores | WORKER_CONCURRENCY | SUBMIT_CONCURRENCY | TC_CONCURRENCY | WORKER_CPU_LIMIT |
|---------------|-------------------|-------------------|----------------|-----------------|
| 4 cores       | 3                 | 2                 | 6              | 3.0             |
| 8 cores       | 6                 | 4                 | 8              | 6.0             |
| 12 cores      | 8                 | 6                 | 12             | 10.0            |
| 16 cores      | 12                | 8                 | 16             | 14.0            |

**Check your core count:**
```bat
wmic cpu get NumberOfCores
```

### Step 4 — Start the Worker

**Option A — Double-click (easiest):**
```
Double-click: worker-node\start-worker.bat
```

**Option B — Command line:**
```bat
docker compose -f worker-node\docker-compose.worker.yml --env-file .env up -d --build
```

### Step 5 — Verify It's Working

```bat
# Check worker container is running:
docker compose -f worker-node\docker-compose.worker.yml ps

# Watch live logs:
docker compose -f worker-node\docker-compose.worker.yml logs -f

# On PC-1, check that workers are visible in the queue:
cd CPP-Complier
node scripts/health-check-workers.js
```

You should see something like:
```
  ┌─ Queue: compiler-jobs
  │  Workers connected : 2          ← Should be 2 (PC-2 + PC-3)
  │  Waiting jobs      : 0
  │  Active jobs       : 0
```

---

## PC-1 Firewall Configuration

**Run these commands on PC-1** (as Administrator) to allow worker PCs to connect:

```powershell
# Allow Redis from LAN (adjust subnet to match your network)
New-NetFirewallRule -DisplayName "Redis LAN" `
    -Direction Inbound -Protocol TCP -LocalPort 6380 `
    -RemoteAddress "192.168.1.0/24" -Action Allow

# Allow PgBouncer from LAN
New-NetFirewallRule -DisplayName "PgBouncer LAN" `
    -Direction Inbound -Protocol TCP -LocalPort 5434 `
    -RemoteAddress "192.168.1.0/24" -Action Allow
```

> Replace `192.168.1.0/24` with your actual LAN subnet.

---

## Updating the Worker

When you update the backend code:

```bat
# On each worker PC:
docker compose -f worker-node\docker-compose.worker.yml down
docker compose -f worker-node\docker-compose.worker.yml up -d --build
```

Or use `start-worker.bat` again (it automatically rebuilds).

---

## Stopping the Worker

```bat
docker compose -f worker-node\docker-compose.worker.yml down
```

Jobs that are in-progress will be allowed to complete (graceful shutdown via SIGTERM).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Cannot reach Redis" | Check PC-1 IP in `.env`. Run `ping 192.168.1.10` from worker PC. Check PC-1 firewall allows port 6380 from LAN. |
| "WRONGPASS" Redis error | Ensure `REDIS_PASSWORD` in `.env` matches PC-1's `REDIS_PASSWORD` in its `.env`. |
| Container exits immediately | Run `docker compose -f worker-node\docker-compose.worker.yml logs` to see the error. |
| Jobs not being processed | Ensure PC-1's Redis is running: `docker compose ps` on PC-1. |
| "ECONNREFUSED 5434" | PC-1's PgBouncer port not accessible. Check firewall rule for port 5434. |
| Worker starts but no jobs appear | Verify users are submitting code in the app. Check API logs on PC-1. |

---

## Rollback: Emergency Local Workers on PC-1

If both PC-2 and PC-3 go offline, enable the fallback local worker on PC-1:

1. Open `docker-compose.yml` on PC-1
2. Find the commented `# worker:` block at the bottom
3. Uncomment all lines in that block
4. Run: `docker compose up -d worker`

This brings workers back to PC-1 temporarily while fixing the worker PCs.

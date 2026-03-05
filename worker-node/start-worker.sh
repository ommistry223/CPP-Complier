#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  Worker Node Startup Script for PC-2 / PC-3 (Linux / WSL)
#
#  Usage:
#    chmod +x worker-node/start-worker.sh
#    ./worker-node/start-worker.sh
# ══════════════════════════════════════════════════════════════════

set -euo pipefail

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     CPP-Compiler Worker Node — Startup           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Change to project root directory ──────────────────────────────
cd "$(dirname "$0")/.."

# ── Check for .env file ───────────────────────────────────────────
if [ ! -f "worker-node/.env" ]; then
    echo "[ERROR] .env file not found in worker-node directory!"
    echo ""
    echo "  Please create an .env file from the template:"
    echo "    cp worker-node/.env.worker.example worker-node/.env"
    echo "  Then edit worker-node/.env with the correct PC-1 IP address and passwords."
    echo ""
    exit 1
fi

# ── Check Docker is running ───────────────────────────────────────
if ! docker info &>/dev/null; then
    echo "[ERROR] Docker is not running!"
    echo "  Please start Docker and try again."
    echo "  On Linux:  sudo systemctl start docker"
    exit 1
fi

echo "[OK] Docker is running."

# ── Load environment variables from .env ─────────────────────────
export $(grep -v '^#' worker-node/.env | grep -v '^$' | xargs)

# ── Test Redis connectivity ───────────────────────────────────────
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6380}"

echo "[INFO] Testing connectivity to Redis at ${REDIS_HOST}:${REDIS_PORT} ..."
if timeout 3 bash -c "echo > /dev/tcp/${REDIS_HOST}/${REDIS_PORT}" 2>/dev/null; then
    echo "[OK] Redis port is reachable."
else
    echo "[WARN] Cannot reach Redis at ${REDIS_HOST}:${REDIS_PORT}"
    echo "       Check that PC-1 firewall allows port ${REDIS_PORT} from this machine."
fi

echo ""
echo "[INFO] Building and starting worker container..."
echo ""

# ── Start worker ──────────────────────────────────────────────────
docker compose -f worker-node/docker-compose.worker.yml --env-file worker-node/.env up -d --build

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Worker started successfully!                    ║"
echo "║                                                  ║"
echo "║  View logs:                                      ║"
echo "║    docker compose -f worker-node/               ║"
echo "║      docker-compose.worker.yml logs -f           ║"
echo "║                                                  ║"
echo "║  Stop worker:                                    ║"
echo "║    docker compose -f worker-node/               ║"
echo "║      docker-compose.worker.yml down              ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

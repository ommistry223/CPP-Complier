@echo off
:: ══════════════════════════════════════════════════════════════════
::  Worker Node Startup Script for PC-2 / PC-3 (Windows)
::
::  Run this script as Administrator on each worker PC.
::  Prerequisites:
::    1. Docker Desktop installed and running
::    2. Git (or just the backend folder copied here)
::    3. .env file configured (see .env.worker.example)
::
::  Usage:
::    Double-click  start-worker.bat
::    OR run from PowerShell:  .\worker-node\start-worker.bat
:: ══════════════════════════════════════════════════════════════════

setlocal EnableDelayedExpansion

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║     CPP-Compiler Worker Node — Startup           ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: ── Change to project root directory ──────────────────────────────
cd /d "%~dp0.."

:: ── Check for .env file ───────────────────────────────────────────
if not exist "worker-node\.env" (
    echo [ERROR] .env file not found in worker-node folder!
    echo.
    echo  Please create a .env file from the template:
    echo    copy worker-node\.env.worker.example worker-node\.env
    echo  Then edit worker-node\.env with the correct PC-1 IP address and passwords.
    echo.
    pause
    exit /b 1
)

:: ── Check Docker is running ───────────────────────────────────────
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running!
    echo Please start Docker Desktop and try again.
    pause
    exit /b 1
)

echo [OK] Docker is running.

:: ── Load PC1_IP from .env for connectivity test ──────────────────
for /f "usebackq tokens=1,2 delims==" %%A in ("worker-node\.env") do (
    if "%%A"=="REDIS_HOST" set REDIS_HOST=%%B
    if "%%A"=="REDIS_PORT" set REDIS_PORT=%%B
)

if "!REDIS_HOST!"=="" (
    echo [WARN] Could not read REDIS_HOST from .env. Skipping connectivity test.
) else (
    echo [INFO] Testing connectivity to Redis at !REDIS_HOST!:!REDIS_PORT! ...
    powershell -Command "try { $tcp = New-Object System.Net.Sockets.TcpClient; $tcp.Connect('!REDIS_HOST!', !REDIS_PORT!); $tcp.Close(); Write-Host '[OK] Redis port is reachable.' } catch { Write-Host '[WARN] Cannot reach Redis at !REDIS_HOST!:!REDIS_PORT! — check PC-1 firewall and IP.' }"
)

echo.
echo [INFO] Pulling latest worker image (if any) and starting...
echo.

:: ── Start worker using the worker-specific compose file ───────────
docker compose -f worker-node\docker-compose.worker.yml --env-file worker-node\.env up -d --build

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start worker container. Check the error above.
    pause
    exit /b 1
)

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║  Worker started successfully!                    ║
echo  ║                                                  ║
echo  ║  - View logs:                                    ║
echo  ║    docker compose -f worker-node\               ║
echo  ║      docker-compose.worker.yml logs -f          ║
echo  ║                                                  ║
echo  ║  - Stop worker:                                  ║
echo  ║    docker compose -f worker-node\               ║
echo  ║      docker-compose.worker.yml down             ║
echo  ╚══════════════════════════════════════════════════╝
echo.
pause

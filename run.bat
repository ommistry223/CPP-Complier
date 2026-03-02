@echo off
setlocal EnableDelayedExpansion
color 0B
echo ===================================================
echo     CODE ARENA  -  LAUNCH
echo ===================================================
echo.
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not in PATH.
    echo Download Docker Desktop: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)
echo [OK] Docker found.
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Desktop is not running.
    echo Please start Docker Desktop and try again.
    pause
    exit /b 1
)
echo [OK] Docker Desktop is running.
echo.
echo Starting CODE ARENA services...
docker compose up -d
if %errorlevel% neq 0 (
    echo [ERROR] docker compose up failed. Run 'docker compose logs' for details.
    pause
    exit /b 1
)
echo.
echo Waiting for services to be healthy...
timeout /t 8 /nobreak >nul
docker compose ps
echo.
echo ===================================================
echo  CODE ARENA IS LIVE!
echo ===================================================
echo.
echo   Platform:    http://localhost
echo   Admin Panel: http://localhost/admin_panel
echo.
echo To stop: run stop-app.bat  (or: docker compose down)
echo ===================================================
pause
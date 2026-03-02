@echo off
setlocal EnableDelayedExpansion
color 0A
echo ===================================================
echo     CODE ARENA  -  FIRST-TIME SETUP
echo ===================================================
echo.
echo Requirements: Docker Desktop must be installed and running.
echo Download: https://www.docker.com/products/docker-desktop
echo.

docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not in PATH.
    pause
    exit /b 1
)
echo [OK] Docker found.

docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Desktop is not running.
    echo Please start Docker Desktop, wait for it to load, then run this script again.
    pause
    exit /b 1
)
echo [OK] Docker Desktop is running.
echo.

echo [1/3] BUILDING DOCKER IMAGES (2-5 minutes on first run)...
docker compose build
if %errorlevel% neq 0 (
    echo [ERROR] Docker build failed. Check errors above.
    pause
    exit /b 1
)
echo [OK] Images built.
echo.

echo [2/3] STARTING DATABASE AND REDIS...
docker compose up -d db redis
echo Waiting for PostgreSQL to be ready...
timeout /t 10 /nobreak >nul
echo [OK] Database and Redis started.
echo.

echo [3/3] RUNNING MIGRATIONS AND SEEDING PROBLEMS...
docker compose run --rm api node src/db/migrate.js
docker compose run --rm api node src/db/seed.js
echo [OK] Database initialised.
echo.

echo ===================================================
echo  SETUP COMPLETE!
echo ===================================================
echo.
echo Next step: double-click  run.bat  to launch CODE ARENA.
echo.
echo   Platform:    http://localhost
echo   Admin Panel: http://localhost/admin_panel
echo ===================================================
pause
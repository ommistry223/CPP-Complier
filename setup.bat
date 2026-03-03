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

echo [1/4] BUILDING DOCKER IMAGES (2-5 minutes on first run)...
docker compose build
if %errorlevel% neq 0 (
    echo [ERROR] Docker build failed. Check errors above.
    pause
    exit /b 1
)
echo [OK] Images built.
echo.

echo [2/4] STARTING DATABASE, REDIS AND PGBOUNCER...
docker compose up -d db redis pgbouncer
if %errorlevel% neq 0 (
    echo [ERROR] Failed to start infrastructure services.
    pause
    exit /b 1
)
echo Waiting for PostgreSQL to be ready (up to 60s)...
timeout /t 10 /nobreak >nul

set /a attempts=0
:DB_WAIT_LOOP
docker compose exec -T db pg_isready -U postgres >nul 2>&1
if %errorlevel% equ 0 goto DB_READY
set /a attempts+=1
if %attempts% geq 10 (
    echo [ERROR] PostgreSQL did not become ready in time. Check: docker compose logs db
    pause
    exit /b 1
)
echo   Still waiting for database... (%attempts%/10)
timeout /t 5 /nobreak >nul
goto DB_WAIT_LOOP

:DB_READY
echo [OK] Database is ready.
echo.

echo [3/4] RUNNING DATABASE MIGRATIONS...
docker compose run --rm api1 node src/db/migrate.js
if %errorlevel% neq 0 (
    echo [ERROR] Migration failed. Check errors above.
    pause
    exit /b 1
)
echo [OK] Migrations complete.
echo.

echo [4/4] SEEDING PROBLEMS AND TEST CASES...
docker compose run --rm api1 node src/db/seed.js
if %errorlevel% neq 0 (
    echo [ERROR] Seed failed. Check errors above.
    pause
    exit /b 1
)
echo [OK] Database seeded with problems.
echo.

echo ===================================================
echo  SETUP COMPLETE!
echo ===================================================
echo.
echo Next step: double-click  run.bat  to launch CODE ARENA.
echo.
echo   Platform:    http://localhost:8080
echo   Admin Panel: http://localhost:8080/admin_panel
echo   DB Admin:    http://localhost:5050  (login: admin@codearena.dev / admin123)
echo ===================================================
pause
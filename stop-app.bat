@echo off
setlocal
color 0C
echo ===================================================
echo     CODE ARENA  -  STOP SERVICES
echo ===================================================
echo.

docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not available.
    pause
    exit /b 1
)

echo Stopping all CODE ARENA containers...
docker compose down
if %errorlevel% neq 0 (
    echo [WARN] Some containers may not have stopped cleanly.
) else (
    echo [OK] All containers stopped.
)
echo.

if exist "backend\temp" (
    del /q "backend\temp\*" >nul 2>&1
    echo [OK] Temp files cleared.
)

echo.
echo ===================================================
echo  CODE ARENA STOPPED.
echo ===================================================
echo.
echo To restart:        run.bat
echo To wipe ALL data:  docker compose down -v
echo.
echo Ports when running:
echo   App:      http://localhost:8080
echo   pgAdmin:  http://localhost:5050
echo ===================================================
pause
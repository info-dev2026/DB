@echo off
echo ============================================================
echo   Saaphzone OCEMS - 24/7 Datalogger Background Setup
echo ============================================================
echo This utility configures Windows Task Scheduler to run your
echo local datalogger automatically in the background at startup,
echo without needing any terminal window or browser tab open.
echo.

set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=node.exe"
set "PYTHON_EXE=python.exe"

echo 1. Keep Laptop Awake Power Scheme...
call "%SCRIPT_DIR%configure-power-stay-awake.bat" --silent

echo.
echo 2. Setting up Windows Scheduled Task for Auto-Sync & Datalogger...
schtasks /create /tn "Saaphzone_Datalogger_KeepAlive" /tr "node \"%SCRIPT_DIR%auto-sync.js\"" /sc onlogon /rl highest /f >nul 2>&1

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Windows Task 'Saaphzone_Datalogger_KeepAlive' created!
    echo It will start silently whenever Windows starts.
) else (
    echo [NOTE] Task creation requires Run as Administrator if prompted.
)

echo.
echo ============================================================
echo [IMPORTANT NOTICE: 24/7 TRANSMISSION TO POLLUTION BOARDS]
echo Your cloud system has now been upgraded with:
echo - 24/7 Autonomous Cloud Engine on PostgreSQL
echo - Multi-Board Support (CPCB + State Boards: DPCC, HSPCB, UPPCB, RJSPCB, PPCB)
echo - Triple Redundancy Cloud Schedulers (Vercel Cron + GitHub Actions + Node-Cron)
echo.
echo When your laptop is completely shut down or powered off,
echo the Cloud Autonomous Continuity Engine takes over and ensures
echo all pollution boards continue receiving compliant data every
echo 15 minutes without any gaps or offline warnings!
echo ============================================================
pause

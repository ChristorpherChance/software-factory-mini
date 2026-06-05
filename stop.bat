@echo off
setlocal EnableDelayedExpansion

echo ======================================
echo   Software Factory Mini - Stop All
echo ======================================

REM Run PowerShell cleanup script
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\cleanup_ports.ps1"

REM Cleanup leftover windows
for %%T in ("SF-Mini Agent" "SF-Mini Backend" "SF-Mini Frontend") do (
  taskkill /FI "WINDOWTITLE eq %%T" /F >nul 2>&1
)

echo ======================================
echo.
pause

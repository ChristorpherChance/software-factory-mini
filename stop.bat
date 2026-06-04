@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

REM 停止 software-factory-mini 所有本地服务
REM 用法：双击运行 或 stop.bat

echo ======================================
echo   Software Factory Mini — 停止所有服务
echo ======================================

set STOPPED_ANY=0

REM ── 按端口逐一终止 ─────────────────────
for %%P in (9100 8000 3000) do (
  echo.
  echo [检查] 端口 %%P...

  set FOUND=0
  for /f "tokens=5" %%A in ('netstat -ano 2^>nul ^| findstr ":%%P " ^| findstr "LISTENING"') do (
    if !FOUND! equ 0 (
      set PID=%%A
      set FOUND=1
    )
  )

  if !FOUND! equ 1 (
    echo [停止] 终止 PID !PID! (端口 %%P^)…
    taskkill /PID !PID! /F >nul 2>&1
    if not errorlevel 1 (
      set STOPPED_ANY=1
      echo [√] 已终止 PID !PID!
    ) else (
      echo [!] 无法终止 PID !PID! (可能已退出^)
    )
  ) else (
    echo [跳过] 端口 %%P 未被占用
  )
)

REM ── 额外：按窗口标题清理（start.bat 启动的独立窗口）──
echo.
echo [清理] 检查残留窗口…
for %%T in ("SF-Mini Agent" "SF-Mini Backend" "SF-Mini Frontend") do (
  taskkill /FI "WINDOWTITLE eq %%T" /F >nul 2>&1
  if not errorlevel 1 (
    set STOPPED_ANY=1
    echo [√] 已关闭 %%T 窗口
  )
)

echo.
if %STOPPED_ANY% equ 1 (
  echo [√] 所有服务已停止
) else (
  echo [i] 未发现运行中的服务
)
echo ======================================
echo.
pause

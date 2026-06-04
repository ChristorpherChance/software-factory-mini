@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

REM 一键启动 software-factory-mini（后端 :8000 + 前端 :3000）
REM 双击运行即可，会在两个新窗口分别起后端和前端

set ROOT=%~dp0
set ROOT=%ROOT:~0,-1%

echo ======================================
echo   Software Factory Mini — 启动中
echo ======================================

REM ── 后端 ─────────────────────────────
echo.
echo [后端] 检查 Python venv...
cd /d "%ROOT%\backend"

if not exist ".venv" (
  echo [后端] 首次运行，创建 venv 并安装依赖（约 1-2 分钟）...
  python -m venv .venv
)

if not exist ".venv\Scripts\python.exe" (
  echo [错误] 找不到 Python，请确认 Python 3.11+ 已安装并在 PATH 中
  pause
  exit /b 1
)

REM 检查 fastapi 是否安装
.venv\Scripts\python.exe -c "import fastapi" 2>nul
if errorlevel 1 (
  echo [后端] 安装依赖...
  .venv\Scripts\pip.exe install -q -r requirements.txt
)

if not exist ".env" (
  if exist "%ROOT%\.env.example" copy "%ROOT%\.env.example" ".env" >nul
)

echo [后端] 启动 uvicorn → http://localhost:8000
start "SF-Mini Backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

REM ── 前端 ─────────────────────────────
echo.
echo [前端] 检查 node_modules...
cd /d "%ROOT%\frontend"

if not exist "node_modules" (
  echo [前端] 首次运行，npm install（约 1-2 分钟）...
  npm install
)

if not exist ".env.local" (
  if exist ".env.example" copy ".env.example" ".env.local" >nul
)

echo [前端] 启动 Next.js dev → http://localhost:3000
start "SF-Mini Frontend" cmd /k "npm run dev"

REM ── 等待后端就绪后打开浏览器 ──────────
echo.
echo [等待] 服务启动中，稍后自动打开浏览器...
timeout /t 8 /nobreak >nul

REM 轮询后端健康接口（最多 30s）
set /a count=0
:waitloop
curl -sf http://localhost:8000/api/v1/health >nul 2>&1
if not errorlevel 1 goto backend_ready
set /a count+=1
if %count% geq 30 goto timeout_warn
timeout /t 1 /nobreak >nul
goto waitloop

:timeout_warn
echo [!] 后端 30s 未响应，请检查"SF-Mini Backend"窗口的日志
goto open_browser

:backend_ready
echo [√] 后端已就绪

:open_browser
echo [浏览器] 打开 http://localhost:3000 ...
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo ======================================
echo   后端  http://localhost:8000/docs
echo   前端  http://localhost:3000
echo.
echo   关闭窗口可停止对应服务
echo ======================================
echo.
pause

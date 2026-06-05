@echo off
setlocal EnableDelayedExpansion

REM ============================================
REM  Software Factory Mini - Windows 启动脚本
REM  用法: start.bat [stub^|pi] [--no-open]
REM ============================================
REM  说明: cmd 不允许在 ( ) 括号块内部使用 goto / :label，
REM        故全部用顶层标签 + 线性跳转，避免解析错误闪退。

REM ==== Config ====
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"
if errorlevel 1 (
  echo [ERROR] Cannot enter: %ROOT%
  pause
  exit /b 1
)

set "MODE=stub"
set "OPEN_BROWSER=true"

REM 自动检测: agent-service\.env 中有非空 LLM_API_KEY 则用 pi 模式
if exist "%ROOT%\agent-service\.env" (
  findstr /R /C:"^LLM_API_KEY=..*" "%ROOT%\agent-service\.env" >nul 2>&1
  if not errorlevel 1 set "MODE=pi"
)

REM 命令行参数覆盖 (支持任意顺序)
for %%A in (%*) do (
  if /I "%%~A"=="stub"      set "MODE=stub"
  if /I "%%~A"=="pi"        set "MODE=pi"
  if /I "%%~A"=="--no-open" set "OPEN_BROWSER=false"
)

echo.
echo ============================================
echo   Software Factory Mini
echo   Mode: %MODE%  ^|  Browser: %OPEN_BROWSER%
echo ============================================
echo.

REM ==== Prerequisites ====
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+
  echo   https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=*" %%V in ('node -v 2^>nul') do echo [OK] Node.js: %%V

set "PYTHON_EXE="
for %%C in (python python3) do (
  if "!PYTHON_EXE!"=="" (
    where %%C >nul 2>&1
    if not errorlevel 1 set "PYTHON_EXE=%%C"
  )
)
if "%PYTHON_EXE%"=="" (
  echo [ERROR] Python not found. Install Python 3.11+
  echo   https://python.org
  pause
  exit /b 1
)
for /f "tokens=*" %%V in ('%PYTHON_EXE% --version 2^>nul') do echo [OK] Python: %%V

echo.

REM ==== Port Cleanup ====
echo [Clean] Releasing ports 9100/8001/8000/3000...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\cleanup_ports.ps1"
timeout /t 2 /nobreak >nul 2>&1
echo.

REM ==== Agent Service (pi only) ====
if not "%MODE%"=="pi" goto after_agent

if not exist "%ROOT%\agent-service" (
  echo [!] agent-service dir not found, fallback to stub
  set "MODE=stub"
  goto after_agent
)

echo [Pi] Checking agent-service...
cd /d "%ROOT%\agent-service"

if not exist "node_modules" (
  echo [Pi] npm install...
  call npm install
  if errorlevel 1 echo [!] npm install failed
)

if not exist "dist\server.js" (
  echo [Pi] npm run build...
  call npm run build
  if errorlevel 1 echo [!] build failed
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [Pi] Created .env from .env.example
  )
)

echo [Pi] Starting agent-service on port 9100...
start "SF-Mini Agent" cmd /k "cd /d %ROOT%\agent-service && node --env-file=.env dist\server.js"

echo [Pi] Waiting for agent-service (max 20s)...
set /a AGENT_TRIES=0
:wait_agent
curl -sf http://localhost:9100/v1/health >nul 2>&1
if not errorlevel 1 goto agent_ok
set /a AGENT_TRIES+=1
if %AGENT_TRIES% geq 20 goto agent_timeout
timeout /t 1 /nobreak >nul 2>&1
goto wait_agent

:agent_timeout
echo [!] agent-service timeout (backend will fallback to stub)
goto after_agent

:agent_ok
echo [OK] agent-service ready

:after_agent
echo.

REM ==== Backend ====
echo [Backend] Preparing Python env...
cd /d "%ROOT%\backend"

if not exist ".venv\Scripts\python.exe" (
  echo [Backend] Creating venv...
  %PYTHON_EXE% -m venv .venv
  if errorlevel 1 (
    echo [ERROR] venv creation failed
    pause
    exit /b 1
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] python.exe not found in venv. Delete backend\.venv and retry.
  pause
  exit /b 1
)

.venv\Scripts\python.exe -c "import fastapi" 2>nul
if errorlevel 1 (
  echo [Backend] Installing dependencies...
  .venv\Scripts\pip.exe install -q -r requirements.txt
  if errorlevel 1 echo [!] pip install may have failed
)

if not exist ".env" (
  if exist "%ROOT%\.env.example" (
    copy "%ROOT%\.env.example" ".env" >nul
    echo [Backend] Created .env from .env.example
  )
)

echo [Backend] Starting uvicorn on port 8000...
if "%MODE%"=="pi" (
  start "SF-Mini Backend" cmd /k "cd /d %ROOT%\backend && set LLM_PROVIDER=pi&& set PI_BASE=http://localhost:9100/v1&& set PI_WS_BASE=ws://localhost:9100/v1&& .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
) else (
  start "SF-Mini Backend" cmd /k "cd /d %ROOT%\backend && set LLM_PROVIDER=stub&& .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
)

REM ==== Frontend ====
echo [Frontend] Preparing Node env...
cd /d "%ROOT%\frontend"

if not exist "node_modules" (
  echo [Frontend] npm install...
  call npm install
  if errorlevel 1 echo [!] npm install failed
)

if not exist ".env.local" (
  if exist ".env.example" (
    copy ".env.example" ".env.local" >nul
    echo [Frontend] Created .env.local from .env.example
  )
)

echo [Frontend] Starting Next.js on port 3000...
start "SF-Mini Frontend" cmd /k "cd /d %ROOT%\frontend && npm run dev"

REM ==== Wait and Open Browser ====
echo.
echo [Wait] Backend starting (max 30s)...
timeout /t 6 /nobreak >nul 2>&1

set /a TRIES=0
:wait_backend
curl -sf http://localhost:8000/api/v1/health >nul 2>&1
if not errorlevel 1 goto backend_ok
set /a TRIES+=1
if %TRIES% geq 30 goto backend_timeout
timeout /t 1 /nobreak >nul 2>&1
goto wait_backend

:backend_timeout
echo [!] Backend timeout - check "SF-Mini Backend" window
goto maybe_browser

:backend_ok
echo [OK] Backend ready

:maybe_browser
if "%OPEN_BROWSER%"=="true" (
  echo [Browser] Opening http://localhost:3000 ...
  timeout /t 3 /nobreak >nul 2>&1
  start "" http://localhost:3000
)

echo.
echo ============================================
if "%MODE%"=="pi" echo   Pi       http://localhost:9100/v1/health
echo   Backend  http://localhost:8000/docs
echo   Frontend http://localhost:3000
echo.
echo   Stop:    double-click stop.bat
echo   Usage:   start.bat [stub^^^|pi] [--no-open]
echo ============================================
echo.
pause

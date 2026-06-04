@echo off
title Software Factory Mini - 启动中...
REM 切换到 UTF-8（失败不退出）
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

REM ── 工作目录 ─────────────────────────────
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%" 2>nul || (
  echo [错误] 无法进入目录: %ROOT%
  pause
  exit /b 1
)

REM ── 参数解析 ─────────────────────────────
set MODE=stub
set OPEN_BROWSER=true

REM 模式自动检测：agent-service\.env 有非空 LLM_API_KEY → pi
if exist "%ROOT%\agent-service\.env" (
  findstr /C:"LLM_API_KEY=." "%ROOT%\agent-service\.env" >nul 2>&1
  if not errorlevel 1 set MODE=pi
)

REM 参数覆盖
if /I "%~1"=="stub"   set MODE=stub
if /I "%~1"=="pi"     set MODE=pi
if /I "%~1"=="--no-open"  set OPEN_BROWSER=false
if /I "%~2"=="--no-open"  set OPEN_BROWSER=false

echo.
echo ============================================
echo   Software Factory Mini
echo   模式: %MODE%  ^|  自动打开浏览器: %OPEN_BROWSER%
echo ============================================
echo.

REM ════════════════════════════════════════════
REM  阶段 1: 检查前置依赖
REM ════════════════════════════════════════════

REM —— Node.js ——
where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 找不到 Node.js，请安装 Node.js 18+
  echo   下载: https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=*" %%V in ('node -v 2^>nul') do echo [√] Node.js: %%V

REM —— Python ——
set "PYTHON_EXE="
for %%C in (python3 python) do (
  where %%C >nul 2>&1
  if not errorlevel 1 if "!PYTHON_EXE!"=="" set "PYTHON_EXE=%%C"
)
if "%PYTHON_EXE%"=="" (
  echo [错误] 找不到 Python，请安装 Python 3.11+
  echo   下载: https://python.org
  pause
  exit /b 1
)
for /f "tokens=*" %%V in ('%PYTHON_EXE% --version 2^>nul') do echo [√] Python: %%V

echo.

REM ── 端口冲突检测 ─────────────────────────
set PORT_CONFLICT=0
for %%P in (8000 3000 9100) do (
  netstat -ano 2>nul | findstr ":%%P " | findstr "LISTENING" >nul 2>&1
  if not errorlevel 1 (
    if %%P==8000 echo   [!] 端口 8000 ^(backend^) 已被占用
    if %%P==3000 echo   [!] 端口 3000 ^(frontend^) 已被占用
    if %%P==9100 echo   [!] 端口 9100 ^(agent-service^) 已被占用
    set PORT_CONFLICT=1
  )
)
if !PORT_CONFLICT! equ 1 (
  echo.
  echo [提示] 有端口被占用。建议先运行 stop.bat 清理。
  echo 继续启动可能导致部分服务失败。
  echo.
  choice /C YN /N /M "是否继续? (Y/N): "
  if errorlevel 2 exit /b 0
  echo.
)
echo.

REM ════════════════════════════════════════════
REM  阶段 2: agent-service（仅 pi 模式）
REM ════════════════════════════════════════════
if "%MODE%"=="pi" (
  if not exist "%ROOT%\agent-service" (
    echo [!] agent-service 目录不存在，回退到 stub 模式
    echo.
    set MODE=stub
  )
)

if "%MODE%"=="pi" (
  echo [Pi] 检查 agent-service...
  cd /d "%ROOT%\agent-service"

  if not exist "node_modules" (
    echo [Pi] 安装依赖 (npm install)...
    call npm install
    if errorlevel 1 (
      echo [!] npm install 失败，agent-service 可能无法启动
    )
  )

  if not exist "dist\server.js" (
    echo [Pi] 构建 (npm run build)...
    call npm run build
    if errorlevel 1 (
      echo [!] 构建失败，agent-service 可能无法启动
    )
  )

  if not exist ".env" (
    if exist ".env.example" (
      copy ".env.example" ".env" >nul
      echo [Pi] 已从 .env.example 创建 .env
    )
  )

  echo [Pi] 在独立窗口启动 agent-service (端口 9100)...
  REM 检测 --env-file 支持 (Node 20.6+)
  node -e "process.loadEnvFile('./.env')" 2>nul
  if errorlevel 1 (
    echo [Pi] (使用 dotenv 回落模式)
    if not exist "node_modules\dotenv" (
      call npm install dotenv --no-save 2>nul
    )
    start "SF-Mini Agent" cmd /k "cd /d %ROOT%\agent-service && node -r dotenv/config dist\server.js"
  ) else (
    start "SF-Mini Agent" cmd /k "cd /d %ROOT%\agent-service && node --env-file=.env dist\server.js"
  )

  echo [Pi] 等待 agent-service 就绪 (最长 20s)...
  for /L %%i in (1,1,20) do (
    curl -sf http://localhost:9100/v1/health >nul 2>&1
    if not errorlevel 1 (
      echo [√] agent-service 已就绪
      goto agent_ok
    )
    timeout /t 1 /nobreak >nul
  )
  echo [!] agent-service 20s 未响应 (backend 将自动回落 stub)
  :agent_ok
  echo.
)

REM ════════════════════════════════════════════
REM  阶段 3: 后端
REM ════════════════════════════════════════════
echo [后端] 准备 Python 环境...
cd /d "%ROOT%\backend"

if not exist ".venv" (
  echo [后端] 创建虚拟环境...
  %PYTHON_EXE% -m venv .venv
  if errorlevel 1 (
    echo [错误] venv 创建失败
    pause
    exit /b 1
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo [错误] venv 中找不到 python.exe，请手动删除 .venv 目录后重试
  pause
  exit /b 1
)

REM 安装后端依赖
.venv\Scripts\python.exe -c "import fastapi" 2>nul
if errorlevel 1 (
  echo [后端] 安装 Python 依赖...
  .venv\Scripts\pip.exe install -q -r requirements.txt
  if errorlevel 1 (
    echo [!] 依赖安装可能失败，尝试继续...
  )
)

if not exist ".env" (
  if exist "%ROOT%\.env.example" (
    copy "%ROOT%\.env.example" ".env" >nul
    echo [后端] 已从 .env.example 创建 .env
  )
)

echo [后端] 在独立窗口启动 uvicorn (端口 8000)...

if "%MODE%"=="pi" (
  start "SF-Mini Backend" cmd /k "cd /d %ROOT%\backend && set LLM_PROVIDER=pi&& set PI_BASE=http://localhost:9100/v1&& set PI_WS_BASE=ws://localhost:9100/v1&& .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
) else (
  start "SF-Mini Backend" cmd /k "cd /d %ROOT%\backend && set LLM_PROVIDER=stub&& .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
)

REM ════════════════════════════════════════════
REM  阶段 4: 前端
REM ════════════════════════════════════════════
echo [前端] 准备 Node 环境...
cd /d "%ROOT%\frontend"

if not exist "node_modules" (
  echo [前端] 安装依赖 (npm install, 约 1-2 分钟)...
  call npm install
  if errorlevel 1 (
    echo [!] npm install 失败，前端可能无法启动
  )
)

if not exist ".env.local" (
  if exist ".env.example" (
    copy ".env.example" ".env.local" >nul
    echo [前端] 已从 .env.example 创建 .env.local
  )
)

echo [前端] 在独立窗口启动 Next.js (端口 3000)...
start "SF-Mini Frontend" cmd /k "cd /d %ROOT%\frontend && npm run dev"

REM ════════════════════════════════════════════
REM  阶段 5: 等待并打开浏览器
REM ════════════════════════════════════════════
echo.
echo [等待] 后端启动中 (最长 30s)...
timeout /t 6 /nobreak >nul

set TRIES=0
:wait_backend
curl -sf http://localhost:8000/api/v1/health >nul 2>&1
if not errorlevel 1 goto backend_ok
set /a TRIES+=1
if %TRIES% geq 30 goto backend_timeout
timeout /t 1 /nobreak >nul
goto wait_backend

:backend_timeout
echo [!] 后端启动超时，请检查 "SF-Mini Backend" 窗口的日志
goto maybe_browser

:backend_ok
echo [√] 后端已就绪

:maybe_browser
if "%OPEN_BROWSER%"=="true" (
  echo [浏览器] 即将打开 http://localhost:3000 ...
  timeout /t 3 /nobreak >nul
  start http://localhost:3000
)

REM ════════════════════════════════════════════
echo.
echo ============================================
if "%MODE%"=="pi" echo   Pi      http://localhost:9100/v1/health
echo   后端    http://localhost:8000/docs
echo   前端    http://localhost:3000
echo.
echo   停止:  双击 stop.bat 或关闭服务窗口
echo   用法:  start.bat [stub^|pi] [--no-open]
echo ============================================
echo.
pause

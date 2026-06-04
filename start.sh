#!/usr/bin/env bash
# 一键启动 software-factory-mini（bash / Git Bash 环境）
# 用法：bash start.sh [--no-open] [--stub] [--pi]
#   --no-open  启动后不自动打开浏览器
#   --stub     强制 stub 模式（不起 agent-service）
#   --pi       强制 pi 模式（起 agent-service）
#
# 注意：不使用 set -e，避免单个命令失败导致整个脚本闪退

ROOT="$(cd "$(dirname "$0")" && pwd)"
OPEN_BROWSER=true
FORCE=""

for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_BROWSER=false ;;
    --stub)    FORCE="stub" ;;
    --pi)      FORCE="pi" ;;
  esac
done

# ── 前置检查 ──────────────────────────────
check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[错误] 找不到 $1，请确认已安装并在 PATH 中"
    return 1
  fi
  return 0
}

echo "============================================"
echo "  Software Factory Mini"
echo "============================================"
echo ""

echo "[检查] 前置依赖..."

MISSING=0
for cmd in node npm curl; do
  if check_cmd "$cmd"; then
    echo "  [√] $cmd"
  else
    echo "  [!] $cmd — 缺失"
    MISSING=1
  fi
done

# Python 检测
PYTHON_CMD=""
for cmd in python3 python; do
  if command -v "$cmd" >/dev/null 2>&1; then
    PYTHON_CMD="$cmd"
    break
  fi
done
if [ -z "$PYTHON_CMD" ]; then
  echo "  [!] python — 缺失"
  MISSING=1
else
  echo "  [√] python ($PYTHON_CMD)"
fi

if [ $MISSING -eq 1 ]; then
  echo ""
  echo "[错误] 缺少必要依赖，请安装后重试"
  exit 1
fi

echo ""

# ── 端口冲突检测 ──────────────────────────
check_port() {
  local port=$1
  local name=$2
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti :$port >/dev/null 2>&1 && return 0 || return 1
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | grep -q ":$port " && return 0 || return 1
  elif command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null | grep -q ":$port " && return 0 || return 1
  fi
  return 1
}

PORT_CONFLICT=0
for p in 8000 3000 9100; do
  case $p in
    8000) pname="backend" ;;
    3000) pname="frontend" ;;
    9100) pname="agent-service" ;;
  esac
  if check_port $p "$pname"; then
    echo "  [!] 端口 $p ($pname) 已被占用 — 请先运行 bash stop.sh"
    PORT_CONFLICT=1
  fi
done

if [ $PORT_CONFLICT -eq 1 ]; then
  echo ""
  echo "[提示] 有端口被占用。是否继续？(y/n)"
  read -r answer
  if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
    echo "已取消。请先运行: bash stop.sh"
    exit 0
  fi
  echo "继续启动（端口冲突可能导致部分服务失败）…"
  echo ""
fi

# ── 模式自动检测 ─────────────────────────
MODE="stub"
if [ "$FORCE" = "pi" ]; then
  MODE="pi"
elif [ "$FORCE" = "stub" ]; then
  MODE="stub"
elif [ -d "$ROOT/agent-service" ] && [ -f "$ROOT/agent-service/.env" ]; then
  if grep -qE '^LLM_API_KEY=.+' "$ROOT/agent-service/.env" 2>/dev/null; then
    MODE="pi"
  fi
fi

echo "模式: $MODE  |  自动打开浏览器: $OPEN_BROWSER"
echo ""

AGENT_PID=""

# ── agent-service（仅 pi 模式）────────────
if [ "$MODE" = "pi" ]; then
  echo "[Pi] 检查 agent-service…"

  if [ ! -d "$ROOT/agent-service" ]; then
    echo "[!] agent-service 目录不存在，回退到 stub 模式"
    MODE="stub"
  else
    cd "$ROOT/agent-service" || { echo "[!] 无法进入 agent-service 目录"; MODE="stub"; }
  fi

  if [ "$MODE" = "pi" ]; then
    if [ ! -d "node_modules" ]; then
      echo "[Pi] npm install…"
      npm install || echo "[!] npm install 失败"
    fi

    if [ ! -f "dist/server.js" ]; then
      echo "[Pi] npm run build…"
      npm run build || echo "[!] 构建失败"
    fi

    [ -f ".env" ] || cp .env.example .env 2>/dev/null || true

    echo "[Pi] 启动 agent-service → http://localhost:9100"
    node --env-file=.env dist/server.js &
    AGENT_PID=$!

    # 等待就绪
    echo -n "[Pi] 等待 agent-service 就绪"
    for i in $(seq 1 20); do
      if curl -sf http://localhost:9100/v1/health >/dev/null 2>&1; then
        echo ""
        echo "[√] agent-service 已就绪"
        break
      fi
      echo -n "."
      sleep 1
      [ "$i" -eq 20 ] && echo "" && echo "[!] agent-service 20s 未响应（backend 将回落 stub）"
    done

    cd "$ROOT"
  fi
fi

# ── 后端 ─────────────────────────────────
echo ""
echo "[后端] 准备 Python 环境…"
cd "$ROOT/backend" || { echo "[错误] 无法进入 backend 目录"; exit 1; }

if [ ! -d ".venv" ]; then
  echo "[后端] 创建 venv…"
  "$PYTHON_CMD" -m venv .venv || { echo "[错误] venv 创建失败"; exit 1; }
fi

# 兼容 Windows (Scripts) / macOS·Linux (bin)
PY="./.venv/Scripts/python.exe"
PIP="./.venv/Scripts/pip.exe"
[ -f "$PY" ] || PY="./.venv/bin/python"
[ -f "$PIP" ] || PIP="./.venv/bin/pip"

if [ ! -f "$PY" ]; then
  echo "[错误] 找不到 venv 中的 Python: $PY"
  echo "  请删除 .venv 目录后重试"
  exit 1
fi

if ! "$PY" -c "import fastapi" 2>/dev/null; then
  echo "[后端] 安装依赖…"
  "$PIP" install -q -r requirements.txt || echo "[!] 依赖安装可能失败"
fi

[ -f ".env" ] || cp "$ROOT/.env.example" .env 2>/dev/null || true

if [ "$MODE" = "pi" ]; then
  export LLM_PROVIDER=pi
  export PI_BASE=http://localhost:9100/v1
  export PI_WS_BASE=ws://localhost:9100/v1
  echo "[后端] 启动 uvicorn（pi）→ http://localhost:8000"
else
  export LLM_PROVIDER=stub
  echo "[后端] 启动 uvicorn（stub）→ http://localhost:8000"
fi

"$PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# ── 前端 ─────────────────────────────────
echo ""
echo "[前端] 准备 Node 环境…"
cd "$ROOT/frontend" || { echo "[!] 无法进入 frontend 目录"; kill $BACKEND_PID 2>/dev/null; exit 1; }

if [ ! -d "node_modules" ]; then
  echo "[前端] npm install（约 1-2 分钟）…"
  npm install || echo "[!] npm install 失败"
fi

[ -f ".env.local" ] || cp .env.example .env.local 2>/dev/null || true

echo "[前端] 启动 Next.js dev → http://localhost:3000"
npm run dev &
FRONTEND_PID=$!

# ── 等待后端就绪 ─────────────────────────
echo ""
echo "[等待] 后端就绪中…"
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/api/v1/health >/dev/null 2>&1; then
    echo "[√] 后端已就绪"
    break
  fi
  sleep 1
  [ "$i" -eq 30 ] && echo "[!] 后端 30s 未响应，请检查日志"
done

# ── 打开浏览器 ───────────────────────────
if $OPEN_BROWSER; then
  echo "[浏览器] 打开 http://localhost:3000 …"
  sleep 2
  if command -v start >/dev/null 2>&1; then
    start http://localhost:3000
  elif command -v open >/dev/null 2>&1; then
    open http://localhost:3000
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:3000
  fi
fi

echo ""
echo "============================================"
[ "$MODE" = "pi" ] && echo "  Pi      http://localhost:9100/v1/health"
echo "  后端    http://localhost:8000/docs"
echo "  前端    http://localhost:3000"
echo ""
echo "  Ctrl+C 停止所有服务（或另开终端跑 bash stop.sh）"
echo "============================================"

# ── 优雅退出 ─────────────────────────────
cleanup() {
  echo ""
  echo "[停止] 正在关闭服务…"
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$AGENT_PID" ] && kill "$AGENT_PID" 2>/dev/null || true
  echo "[√] 已停止"
}
trap cleanup INT TERM

# 等待任意子进程退出
wait $BACKEND_PID $FRONTEND_PID $AGENT_PID 2>/dev/null || true

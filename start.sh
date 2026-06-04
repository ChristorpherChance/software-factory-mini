#!/usr/bin/env bash
# 一键启动 software-factory-mini（后端 :8000 + 前端 :3000）
# 用法：bash start.sh [--no-open]
#   --no-open  启动后不自动打开浏览器
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
OPEN_BROWSER=true
for arg in "$@"; do [[ "$arg" == "--no-open" ]] && OPEN_BROWSER=false; done

echo "======================================"
echo "  Software Factory Mini — 启动中"
echo "======================================"

# ── 后端 ─────────────────────────────────
echo ""
echo "[后端] 检查 Python venv…"
cd "$ROOT/backend"

if [ ! -d ".venv" ]; then
  echo "[后端] 首次运行，创建 venv 并安装依赖（约 1-2 分钟）…"
  python -m venv .venv
fi

# 兼容 Windows (Scripts) / macOS·Linux (bin)
PY="./.venv/Scripts/python.exe"
PIP="./.venv/Scripts/pip.exe"
[ -f "$PY" ] || PY="./.venv/bin/python"
[ -f "$PIP" ] || PIP="./.venv/bin/pip"

# 检查 fastapi 是否已安装，避免每次 install
if ! "$PY" -c "import fastapi" 2>/dev/null; then
  echo "[后端] 安装依赖…"
  "$PIP" install -q -r requirements.txt
fi

# 初始化 .env（若不存在）
[ -f ".env" ] || cp "$ROOT/.env.example" "$ROOT/backend/.env" 2>/dev/null || true

echo "[后端] 启动 uvicorn → http://localhost:8000  (docs: http://localhost:8000/docs)"
"$PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# ── 前端 ─────────────────────────────────
echo ""
echo "[前端] 检查 node_modules…"
cd "$ROOT/frontend"

if [ ! -d "node_modules" ]; then
  echo "[前端] 首次运行，npm install（约 1-2 分钟）…"
  npm install
fi

[ -f ".env.local" ] || cp .env.example .env.local 2>/dev/null || true

echo "[前端] 启动 Next.js dev → http://localhost:3000"
npm run dev &
FRONTEND_PID=$!

# ── 等待后端就绪 ──────────────────────────
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

# ── 打开浏览器 ────────────────────────────
if $OPEN_BROWSER; then
  echo "[浏览器] 打开 http://localhost:3000 …"
  sleep 2  # 给前端 dev server 额外 2s
  if command -v start >/dev/null 2>&1; then
    start http://localhost:3000      # Windows
  elif command -v open >/dev/null 2>&1; then
    open http://localhost:3000       # macOS
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:3000   # Linux
  fi
fi

echo ""
echo "======================================"
echo "  后端  http://localhost:8000/docs"
echo "  前端  http://localhost:3000"
echo ""
echo "  Ctrl+C 停止所有服务"
echo "======================================"

# ── 优雅退出 ─────────────────────────────
cleanup() {
  echo ""
  echo "[停止] 正在关闭服务…"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  echo "[√] 已停止"
}
trap cleanup INT TERM

wait "$BACKEND_PID" "$FRONTEND_PID"

#!/usr/bin/env bash
# 本地一键起前端（Next.js dev，端口取自 ports.env，/api 代理到后端）。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 端口单一配置源（改端口只改 ports.env）
if [ -f "$ROOT/ports.env" ]; then
  set -a; . "$ROOT/ports.env"; set +a
fi
BACKEND_PORT="${BACKEND_PORT:-8001}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"
# 前端访问后端的地址：由 BACKEND_PORT 派生并导出，压过 .env.local 默认值
export BACKEND_ORIGIN="http://localhost:${BACKEND_PORT}"
export NEXT_PUBLIC_SSE_BASE="http://localhost:${BACKEND_PORT}/api/v1"

cd "$ROOT/frontend"

# 检测 Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 找不到 Node.js，请确认 Node.js 18+ 已安装并在 PATH 中"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[setup] npm install…"
  npm install
fi
[ -f ".env.local" ] || cp .env.example .env.local

echo "[run] 启动前端 http://localhost:${FRONTEND_PORT}"
npm run dev -- -p "$FRONTEND_PORT"

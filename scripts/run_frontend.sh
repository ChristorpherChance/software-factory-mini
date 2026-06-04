#!/usr/bin/env bash
# 本地一键起前端（Next.js dev，端口 3000，/api 代理到后端 8000）。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

echo "[run] 启动前端 http://localhost:3000"
npm run dev

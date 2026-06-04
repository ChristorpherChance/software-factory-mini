#!/usr/bin/env bash
# 本地一键起前端（Next.js dev，端口 3000，/api 代理到后端 8000）。
set -e
cd "$(dirname "$0")/../frontend"

if [ ! -d "node_modules" ]; then
  echo "[setup] npm install…"
  npm install
fi
[ -f ".env.local" ] || cp .env.example .env.local

echo "[run] 启动前端 http://localhost:3000"
npm run dev

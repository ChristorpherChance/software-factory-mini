#!/usr/bin/env bash
# 本地一键起后端（stub 模式，SQLite + 内存事件总线，零外部依赖）。
set -e
cd "$(dirname "$0")/../backend"

if [ ! -d ".venv" ]; then
  echo "[setup] 创建 venv 并安装依赖…"
  python -m venv .venv
  ./.venv/Scripts/pip install -q -r requirements.txt 2>/dev/null || ./.venv/bin/pip install -q -r requirements.txt
fi

PY=./.venv/Scripts/python.exe
[ -f "$PY" ] || PY=./.venv/bin/python

echo "[run] 启动后端 http://localhost:8000  (docs: /docs)"
"$PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

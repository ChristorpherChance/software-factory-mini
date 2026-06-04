#!/usr/bin/env bash
# 本地一键起后端（stub 模式，SQLite + 内存事件总线，零外部依赖）。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

# 检测可用的 Python 命令
PYTHON_CMD=""
for cmd in python3 python; do
  if command -v "$cmd" >/dev/null 2>&1; then
    PYTHON_CMD="$cmd"
    break
  fi
done
if [ -z "$PYTHON_CMD" ]; then
  echo "[错误] 找不到 Python，请确认 Python 3.11+ 已安装并在 PATH 中"
  exit 1
fi

if [ ! -d ".venv" ]; then
  echo "[setup] 创建 venv 并安装依赖…"
  "$PYTHON_CMD" -m venv .venv
fi

# 兼容 Windows (Scripts) / macOS·Linux (bin)
PY=./.venv/Scripts/python.exe
PIP=./.venv/Scripts/pip.exe
[ -f "$PY" ] || PY=./.venv/bin/python
[ -f "$PIP" ] || PIP=./.venv/bin/pip

if ! "$PY" -c "import fastapi" 2>/dev/null; then
  echo "[setup] 安装依赖…"
  "$PIP" install -q -r requirements.txt
fi

echo "[run] 启动后端 http://localhost:8000  (docs: /docs)"
"$PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

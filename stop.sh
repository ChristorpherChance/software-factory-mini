#!/usr/bin/env bash
# 停止 software-factory-mini 所有本地服务
# 用法：bash stop.sh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "======================================"
echo "  Software Factory Mini — 停止所有服务"
echo "======================================"

# 端口 → 服务名映射
declare -A PORTS=(
  [9100]="agent-service"
  [8000]="backend (uvicorn)"
  [3000]="frontend (Next.js)"
)

STOPPED_ANY=false

for PORT in 9100 8000 3000; do
  echo ""
  echo "[检查] 端口 ${PORT} (${PORTS[$PORT]})…"

  # 尝试多种方式查找占用端口的 PID
  PID=""
  if command -v lsof >/dev/null 2>&1; then
    PID=$(lsof -ti :$PORT 2>/dev/null || true)
  elif command -v fuser >/dev/null 2>&1; then
    PID=$(fuser ${PORT}/tcp 2>/dev/null || true)
  elif command -v netstat >/dev/null 2>&1; then
    # Windows / Git Bash: netstat -ano
    PID=$(netstat -ano 2>/dev/null | grep ":${PORT} " | grep LISTENING | awk '{print $NF}' | head -1 || true)
  elif command -v ss >/dev/null 2>&1; then
    PID=$(ss -tlnp 2>/dev/null | grep ":${PORT} " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
  fi

  if [ -n "$PID" ]; then
    for p in $PID; do
      if kill -0 "$p" 2>/dev/null; then
        echo "[停止] 终止 PID $p (端口 ${PORT})…"
        kill "$p" 2>/dev/null || true
        sleep 1
        if kill -0 "$p" 2>/dev/null; then
          echo "[强制] kill -9 $p"
          kill -9 "$p" 2>/dev/null || true
        fi
        STOPPED_ANY=true
      fi
    done
  fi

  if [ -z "$PID" ]; then
    echo "[跳过] 端口 ${PORT} 未被占用"
  fi
done

echo ""
if $STOPPED_ANY; then
  echo "[√] 所有服务已停止"
else
  echo "[i] 未发现运行中的服务"
fi
echo "======================================"

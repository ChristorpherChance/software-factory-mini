#!/usr/bin/env bash
# 停止 software-factory-mini 所有本地服务
# 用法：bash stop.sh
#
# 策略：Windows(Git Bash) 优先复用 PowerShell 的 cleanup_ports.ps1（按端口精准杀，
#       不会误伤其他 node/python 进程）；真正的 macOS/Linux 走 lsof/fuser + kill。

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORTS="9100 8001 8000 3000"

echo "======================================"
echo "  Software Factory Mini — 停止所有服务"
echo "======================================"

# ── Windows：复用 PowerShell 精准清理 ────────────────────────
if command -v powershell >/dev/null 2>&1 && [ -f "$ROOT/scripts/cleanup_ports.ps1" ]; then
  echo "[Windows] 调用 cleanup_ports.ps1 按端口清理…"
  powershell -NoProfile -ExecutionPolicy Bypass -File "$ROOT/scripts/cleanup_ports.ps1"
  echo ""
  echo "[√] 完成"
  echo "======================================"
  exit 0
fi

# ── macOS / Linux：lsof / fuser + kill ──────────────────────
STOPPED_ANY=false

for PORT in $PORTS; do
  echo ""
  echo "[检查] 端口 ${PORT}…"

  PID=""
  if command -v lsof >/dev/null 2>&1; then
    PID=$(lsof -ti :"$PORT" 2>/dev/null || true)
  elif command -v fuser >/dev/null 2>&1; then
    PID=$(fuser "${PORT}/tcp" 2>/dev/null || true)
  fi

  if [ -z "$PID" ]; then
    echo "[跳过] 端口 ${PORT} 未被占用"
    continue
  fi

  for p in $PID; do
    if kill -0 "$p" 2>/dev/null; then
      echo "[停止] 终止 PID $p (端口 ${PORT})…"
      kill "$p" 2>/dev/null || true
      sleep 1
      kill -9 "$p" 2>/dev/null || true
      STOPPED_ANY=true
    fi
  done
done

echo ""
if $STOPPED_ANY; then
  echo "[√] 所有服务已停止"
else
  echo "[i] 未发现运行中的服务"
fi
echo "======================================"

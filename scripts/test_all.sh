#!/usr/bin/env bash
# 一键跑全部本地测试：POC-1 / POC-2 / 集成测试 / E2E 冒烟。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

# 优先使用 venv，其次系统 Python
PY=./.venv/Scripts/python.exe
[ -f "$PY" ] || PY=./.venv/bin/python
[ -f "$PY" ] || {
  # 回落系统 python（检测 python3 → python）
  PY=""
  for cmd in python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
      PY="$cmd"
      break
    fi
  done
}
if [ -z "$PY" ] || [ ! -f "$PY" ] && ! command -v "$PY" >/dev/null 2>&1; then
  echo "[错误] 找不到 Python，请先创建 venv 或确认 Python 在 PATH 中"
  exit 1
fi

echo "================ POC-1 资料解析 ================"
"$PY" -X utf8 -m tests.poc1_material_parse
echo "================ POC-2 委派环路 ================"
"$PY" -X utf8 -m tests.poc2_delegate
echo "================ 集成测试 (pytest) ================"
"$PY" -X utf8 -m pytest tests/test_integration.py -q
echo "================ E2E 冒烟 ================"
"$PY" -X utf8 -m tests.smoke_e2e
echo ""
echo "✅ 全部测试通过"

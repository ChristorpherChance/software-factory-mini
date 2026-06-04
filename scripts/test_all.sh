#!/usr/bin/env bash
# 一键跑全部本地测试：POC-1 / POC-2 / 集成测试 / E2E 冒烟。
set -e
cd "$(dirname "$0")/../backend"

PY=./.venv/Scripts/python.exe
[ -f "$PY" ] || PY=./.venv/bin/python
[ -f "$PY" ] || PY=python   # 回落系统 python

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

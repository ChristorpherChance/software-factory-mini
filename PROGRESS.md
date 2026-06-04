# 软件工厂缩小版 · 落地实现进度与执行计划（断点续传用）

> 本文件是**实现进度的唯一事实源**。若会话中断，重新打开后先读本文件即可续接。
> 最后更新：进行中（核心契约层已完成，开始领域逻辑）。

## 0. 环境适配决策（本机无 Docker / 无 PG / 无 Redis / 无 OCR / 无 LLM key）

| 维度 | 文档假设 | 本地落地 | 切换方式（云端） |
|---|---|---|---|
| 容器 | docker-compose | 本地直接起进程 | 保留 docker-compose.yml |
| DB | Postgres 14 | SQLite (aiosqlite) | `DATABASE_URL=postgresql+asyncpg://...` |
| 事件总线 | Redis Streams | 进程内 pub/sub（同 `publish/subscribe` 签名 + Last-Event-ID 回放）| `EVENT_BACKEND=redis` |
| OCR | PaddleOCR | 图片优雅降级为占位文本 | 安装 paddleocr 后启用 |
| LLM | Anthropic（需 key） | `stub` provider（确定性/离线/可测）| `LLM_PROVIDER=anthropic`+`LLM_API_KEY` |
| Python | 3.11 | 3.14（核心依赖已验证可装）| — |

## 1. 已锁定的跨模块契约（领域/路由/前端都按此对齐）

### 1.1 事件（六类，SSE event 名）
`message.delta` / `message.end` / `task.update` / `artifact.created` / `hitl.request` / `stage.gate`
- `core/events.py`：`await publish(session_id, type_, data)`；`async for ev in subscribe(session_id, last_id)`，`ev={id,type,data}`。

### 1.2 LLM（`core/llm.py`）
- `await structure_material(text) -> dict`（符合 MATERIAL_SCHEMA，stub 确定性 → 双跑 sha256 一致）
- `await generate_requirement(kind, upstream) -> str`（Markdown，含 `R-/CR-/PRD-F-` 编号与「上溯：X」行）

### 1.3 RTM 边方向约定（**统一**，解决文档自相矛盾）
- 边 `from = 下游/子（更具体）`，`to = 上游/父（来源）`，`relation='derives'`。
  例：`PRD-F-001 上溯 CR-001` → edge(from=PRD-F-001, to=CR-001)。
- `services/rtm.coverage_report(db, pid)` 返回**超集**键：
  `{ "L0a","L0b","L0c", "byLayer":{...}, "orphans":[...], "healthScore":float, "overall":float }`
  - 覆盖率：对 (up,down) 对，up 层节点被某 down 层节点指向 = 已覆盖。
  - `L0c`(PRD→DSG) 因设计阶段不在本期，downstream 无节点时记 1.0 且**不计入 healthScore**。
  - `healthScore=overall`，仅对「downstream 有节点」的层对取平均；门限 0.85。

### 1.4 数据库/模型（`models/entities.py` 单一真源）
- 统一可移植类型：String(36) 主键、JSON、Text。SQLite 不加 CHECK。
- 设置域用 **M-SET 完整版**（取代 M1 最小 settings）。
- `Artifact.status`(draft|finalized)；新增 `StageGate` 表（finalize 写入）。
- `models/settings.py` 仅 re-export entities 的 Setting/Endpoint/…。

### 1.5 鉴权/响应
- Bearer：`Authorization: Bearer dev-single-workspace-token`（默认）。
- 成功：`{data, meta}`；列表：`{data, page, meta}`；错误：`{error:{code,message,details,requestId}}`。
- 乐观锁：`If-Match: <version>`，冲突 409 CONFLICT。

### 1.6 关键路由（前端按此对接；含对文档 api.ts 的少量增强）
- 项目：`POST/GET /projects`、`GET/PATCH/DELETE /projects/{pid}`
- 会话：`POST/GET /projects/{pid}/sessions`、`POST /sessions/{sid}/subsessions`
- 消息：`POST/GET /sessions/{sid}/messages`、`POST /sessions/{sid}/messages/{mid}/cancel`、SSE `/sessions/{sid}/stream`
- 资料：`POST /projects/{pid}/materials`（跑解析→存 artifact type=material_parsed）、`GET /projects/{pid}/materials`
- 工件：`POST/GET /projects/{pid}/artifacts`(支持 `?type=&stage=`)、`GET /artifacts/{aid}`(含 content)、`PUT /artifacts/{aid}`、`GET /artifacts/{aid}/versions[/{v}]`、`GET /artifacts/{aid}/diff?from=&to=`、`POST /artifacts/{aid}/rollback`
- 任务：`GET/POST /projects/{pid}/tasks`、`POST /tasks/{tid}/transitions`
- 待定区：`GET /projects/{pid}/pending-changes`、`POST /pending-changes/{cid}/{approve|reject|edit-approve}`
- 阶段门：`GET /projects/{pid}/stage-gates`、`POST .../{stage}/check`、`POST .../{stage}/pass`
- RTM：`GET /projects/{pid}/rtm`、`GET /projects/{pid}/rtm/report`、`POST /projects/{pid}/rtm/recompute`
- 自检/定稿：`POST /projects/{pid}/selfcheck`、`POST /projects/{pid}/finalize`
- 委派：`POST /projects/{pid}/delegate`、`GET /projects/{pid}/delegate-audits`
- 设置：`GET /projects/{pid}/settings?sid=`、`PUT /projects/{pid}/sessions/{sid}/override`、`POST/GET /projects/{pid}/endpoints`、`POST /projects/{pid}/endpoints/{eid}/test`、`GET /projects/{pid}/setting-audit`、导入导出 `GET/POST /projects/{pid}/settings/export|import`

## 2. 文件清单与勾选

### 后端 core/契约（Task#1）✅ 全部完成
- [x] app/__init__.py config.py db.py db_init.py main.py sse.py deps.py
- [x] app/models/{base,entities,__init__,settings}.py
- [x] app/core/{__init__,errors,events,crypto,blob,llm,observability}.py
- [x] app/schemas/__init__.py  app/api/v1/{__init__,_common}.py

### 后端领域逻辑（Task#2）⬜
- [ ] agents/material/{__init__,detect,extract,structure,consistency,readiness,pipeline}.py
- [ ] agents/requirement/{__init__,generator}.py
- [ ] agents/orchestrator/{__init__,state_machine,dag,policy,gates}.py
- [ ] services/{__init__,rtm,selfcheck,triple_check,selfcheck_report,finalize,settings,settings_io}.py
- [ ] delegate/{__init__,base,pi_native,claude_code,generic_http,registry,redact,fallback,service}.py

### 后端 API 路由（Task#3）⬜
- [ ] api/v1/{projects,sessions,messages,artifacts,tasks,pending_changes,stage_gates,rtm,settings,delegate,selfcheck,materials?}.py
  （materials 合并进 artifacts.py 或单列）

### 前端（Task#4）⬜ — 由后台 agent 构建，详见 frontend/
### 测试/脚本/文档（Task#5）⬜ — tests/poc1,poc2,pytest；scripts/；README
### 集成运行（Task#6）⬜

## 3. 恢复指令（中断后照做）
1. 读本文件 §1 契约 + §2 勾选，定位下一个未完成文件。
2. 校验已有文件未被截断：
   `cd software-factory-mini/backend && /tmp/sfprobe/Scripts/python.exe -m py_compile $(find app -name '*.py')`
   （或 `python -c "import compileall,sys; sys.exit(0 if compileall.compile_dir('app',quiet=1) else 1)"`）
3. 临时验证 venv：`/tmp/sfprobe/Scripts/python.exe`（已装 fastapi/sqlalchemy/aiosqlite/cryptography/redis/pyyaml/pdfminer/python-docx）。
4. 正式 venv 在 `software-factory-mini/backend/.venv`（Task#6 创建）。
5. 起后端：`uvicorn app.main:app --port 8000`；健康检查 `GET /api/v1/health`。
6. 前端：`cd frontend && npm i && npm run dev`（端口 3000）。
7. POC：`python -m tests.poc1_material_parse` / `poc2_delegate`。

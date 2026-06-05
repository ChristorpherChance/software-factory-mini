# 软件工厂缩小版（Software Factory Mini）

S3 系列（M1–M3 + M-SET）的**可运行实现**。技术基线＝方案甲（Pi 多 target 抽象 + Next.js 14/React 前端 + FastAPI 后端）。本仓库做了**本地零依赖适配**：默认用 SQLite + 进程内事件总线 + 离线确定性 LLM stub，无需 Docker/Postgres/Redis/API Key 即可完整跑通「资料 → 需求三件套 → 追溯矩阵 → 自检 → 定稿」全流程；云端切换为 Postgres/Redis/真实 LLM 不改业务代码。

## 功能覆盖

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 后端 | 基座/模型/资料解析管线/三件套生成/编排状态机/RTM/自检/设置最小集 | ✅ |
| M1 前端 | 五区栅格外壳 / SSE 六事件 / 对话区 / 资料视图 / 需求三件套 / 矩阵中心 / HITL 三档 | ✅ |
| M2 | 委派（pi_subsession/claude_code/generic_http+mock）+ 脱敏 + 降级链 + 审计 / DAG 调度 / 重试超时 / 阶段门 / 可观测 / Task 列表页 / 审计页 | ✅ |
| M3 | 三检（完备/一致/可测）+ 自检报告工件 + 定稿门禁 + HITL 联动 | ✅ |
| M-SET | 设置 6 分类 + 端点 CRUD + 连通性测试 + 会话覆盖 + 导入导出 + 审计页 + AES-256-GCM 密钥加密 | ✅ |

## 目录结构

```
software-factory-mini/
├── backend/                FastAPI 后端（Python 3.11+）
│   ├── app/
│   │   ├── core/           errors / events(内存事件总线) / crypto / blob / llm(provider) / observability
│   │   ├── models/         SQLAlchemy 实体（可移植 SQLite/PG）
│   │   ├── schemas/        pydantic I/O 契约
│   │   ├── api/v1/         全部路由（projects/sessions/messages/materials/artifacts/tasks/
│   │   │                   pending_changes/stage_gates/rtm/settings/delegate/selfcheck）
│   │   ├── agents/         material 解析管线 · requirement 生成 · orchestrator 状态机/DAG/策略/门
│   │   ├── services/       rtm / selfcheck / triple_check / finalize / settings / settings_io
│   │   ├── delegate/       方案C 委派抽象 + 适配器 + 脱敏 + 降级 + 服务
│   │   ├── sse.py          SSE 六事件通道
│   │   └── main.py         应用装配
│   ├── tests/              POC-1 / POC-2 / 集成测试 / E2E 冒烟 / 样本
│   ├── migrations/         0001_init.sql（云端 Postgres 用）
│   └── requirements.txt
├── frontend/               Next.js 14 + React 18 + Zustand + TanStack Query + Tailwind
├── nginx/nginx.conf        SSE 直通反代（云端）
├── docker-compose.yml      云端单机编排
├── scripts/                run_backend.sh / run_frontend.sh / test_all.sh
└── PROGRESS.md             实现进度与契约（断点续传用）
```

## 本地快速开始（无需 Docker）

前置：Node ≥ 18、Python ≥ 3.11。

> **端口配置（单一来源）**：后端默认 `8001`、前端默认 `3001`、agent-service `9100`。
> 全部集中在仓库根 **`ports.env`**——要换端口只改这一个文件，`start.sh/start.bat/stop.sh/`
> `cleanup_ports.ps1/run_backend.sh/run_frontend.sh` 都会读取它。Docker/云端用 docker-compose
> 里同名的 `${BACKEND_PORT}/${FRONTEND_PORT}`（可在 `.env` 覆盖，改后需同步 `nginx/nginx.conf`）。
> 下方手动命令里的 `8001/3001` 仅为默认值示例。

### 1) 后端
```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # Windows
# 或 .venv/bin/pip install -r requirements.txt     # macOS/Linux
.venv/Scripts/python -m uvicorn app.main:app --port 8001 --reload
```
打开 http://localhost:8001/docs 验证；健康检查 `GET /api/v1/health`。
首次启动自动建表（SQLite 文件 `backend/sfmini.db`）。

### 2) 前端
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```
打开 http://localhost:3001 ——新建项目 → 进入工作台 → 在右侧对话区粘贴/发送资料触发解析 → 依次「生成 ORD/CRD/PRD」→ 矩阵中心看覆盖率 → 需求页底部运行自检并定稿。
（前端 `/api/v1/*` 经 `next.config.mjs` rewrites 代理到后端 8001，SSE 直通。）

### 3) 跑测试
```bash
cd backend
.venv/Scripts/python -m tests.poc1_material_parse     # POC-1 资料解析
.venv/Scripts/python -m tests.poc2_delegate           # POC-2 委派环路
.venv/Scripts/python -m pytest tests/test_integration.py -q   # 12 项集成测试
.venv/Scripts/python -m tests.smoke_e2e               # 端到端冒烟
# 或一键：bash scripts/test_all.sh
```

## 关键设计与本地适配

| 维度 | 文档基线 | 本地默认 | 云端切换 |
|---|---|---|---|
| 数据库 | Postgres 14 | SQLite (aiosqlite) | `DATABASE_URL=postgresql+asyncpg://…` |
| 事件总线 | Redis Streams | 进程内 pub/sub + Last-Event-ID 回放 | `EVENT_BACKEND=redis` + `REDIS_URL` |
| LLM | Anthropic | `stub`（离线确定性，双跑一致）| `LLM_PROVIDER=anthropic` + `LLM_API_KEY` |
| OCR | PaddleOCR | 图片优雅降级占位 | 装 `paddleocr` 后自动启用 |
| 部署 | docker-compose | 本地直接起进程 | `docker compose up -d` |

- **SSE 六事件**：`message.delta / message.end / task.update / artifact.created / hitl.request / stage.gate`。
- **HITL 三档**：`Auto/Semi/Manual`；Semi/Manual 下 Agent 变更先入待定区，经确认落库。
- **RTM 边方向**：`from=下游/子, to=上游/父, relation=derives`；覆盖率门限 0.85。
- **密钥安全**：端点 API Key 经 AES-256-GCM 加密落库，前端仅见 `••••末4位` 与 `hasKey`。

## 云端部署

```bash
cp .env.example .env       # 修改 POSTGRES_PASSWORD / SECRETS_MASTER_KEY / LLM_API_KEY
docker compose up -d --build
# 访问 http://<host>:8080
```
Postgres 初始化自动执行 `backend/migrations/versions/0001_init.sql`。

## 安全提示
- `SECRETS_MASTER_KEY` 生产务必替换为新生成的 32 字节 base64 密钥。
- `AUTH_BEARER_TOKEN` 生产务必替换。
- 默认单工作区 Bearer 鉴权，无 RBAC（与 PRD 裁剪一致）。

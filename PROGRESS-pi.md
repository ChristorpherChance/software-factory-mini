# Pi 集成改造进度（断点续接用）

分支：`feat/pi-integration`。手册：`docs/pi改造-20260604/Pi 集成改造 · Claude Code 执行手册.md`。
方案：见 Claude 计划文件（quizzical-imagining-nest.md）。

> **关键事实**：以实际仓库签名为准（手册多处片段与真实代码不符，已在方案中逐一记录）。
> pi-agent-core@0.78 真实 API：`agent.prompt(string)`→事件、`agent.subscribe`、`agent.abort`、
> 工具用 typebox、`ctx.toolCall.name`、通用 `streamSimple`。DeepSeek 走 provider="deepseek" + api="openai-completions"。
> 默认 `LLM_PROVIDER=stub`（回归底线），pi 可选。DeepSeek Key 仅入 agent-service/.env（gitignore）。

| Phase | 内容 | 状态 | commit | 验收摘要 |
|---|---|---|---|---|
| 0 | agent-service 骨架 + health | ✅ | f3ba9fe | build 通过；/v1/health=200；鉴权 401 正确；建会话 OK；stub 回归 12 绿 |
| 1 | core/llm.py pi 分支（默认 stub） | ✅(回落已验) | (待填) | stub 12 绿；pi 模式 agent-service 502/未起均回落 stub 不报错；anthropic 路径不受影响。**真实 DeepSeek 路径待 Key 验证** |
| 2 | 真流式 WS | ⬜ | | |
| 3 | 编排进 Pi + 工具 + internal 端点 | ⬜ | | |
| 4 | HITL/脱敏/审计/pathGuard 钩子 | ⬜ | | |
| 3.5 | 能力进化双环 + 能力库设置页 | ⬜ | | |
| 5 | tooling 拆分 | ⬜ | | |
| 6 | docker-compose + nginx | ⬜ | | |
| 7 | 确定性基线 + CI | ⬜ | | |
| 8 | 回填 PRD/RTM | ⬜ | | |

## Phase 0 已落盘文件
- `agent-service/`：package.json, tsconfig.json, Dockerfile, .gitignore, .env.example, models.json
- `agent-service/src/`：server.ts, agentManager.ts, agent.ts, model.ts, backend.ts
- `agent-service/src/tools/index.ts`（空，Phase 3 填）
- `agent-service/src/hooks/`：pathGuard.ts, redact.ts, audit.ts, compaction.ts（pathGuard/redact 已完整）
- `agent-service/project/`：SYSTEM.md, AGENTS.md, .pi/{skills,prompts}/.gitkeep

## 运行备忘
- 起 agent-service：`cd agent-service && node dist/server.js`（默认 :9100；需先 `npm run build`）
- 真实调用需 `agent-service/.env` 设 `LLM_API_KEY`（DeepSeek，模型名 deepseek-v4-pro，base https://api.deepseek.com）
- 回归底线：`cd backend && LLM_PROVIDER=stub pytest -q tests/test_integration.py`

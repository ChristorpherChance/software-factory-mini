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
| 1 | core/llm.py pi 分支（默认 stub） | ✅ | 3f3bb7c | stub 12 绿；回落 stub 不 500；anthropic 不受影响；**真实 DeepSeek(deepseek-v4-pro) 端到端打通**（Python pi→agent-service→DeepSeek 出真实非空文本，exit 0）。内容规整留 Phase 3（prompt template）。 |
| 2 | 真流式 WS | ✅ | c194c2a | 装 httpx-ws；messages.py pi 路径消费 agent-service WS token 流。**真实链路**：backend(pi)→WS→DeepSeek，SSE 收 29 个逐 token delta（payload {msg_id,delta,role} 契约不变）。agent-service 停掉后回落假流式（3 delta+end）。stub 12 绿。关键修复：WS message.end 映射自内核 agent_end（非逐个 message_end）；text_delta 提取 ev.delta。 |
| 3 | 编排进 Pi + 工具 + internal 端点 | ✅ | 580fed1 | **3a**(4ee082a)：prompt 模板+薄监督器，pi 真实路径 资料→ORD→CRD→PRD，RTM healthScore=1.0 edgeCount=15 orphans=[]。**3b**：5 工具(typebox)+6 internal 端点(artifact/write,events/task,stage/gate,delegate,audit,tooling/parse)全验证。关键修复：三件套生成临时清空 tools（避免 thinking 模型陷工具循环 terminate）。stub 12 绿 |
| 4 | HITL/脱敏/审计/pathGuard 钩子 | ✅ | ae1876c | write 工具受 pathGuard 约束。**真实验证**：诱导 agent write .pi/skills/evil.md → 被 block(write error)，文件未创建；Semi 档诱导 write notes/hello.md → 发 hitl.request，回 deny → 未创建。pathGuard 单测 9/9。审计：afterToolCall→postAudit→internal/audit（端点 Phase 3b 已验落库）。stub 12 绿。注：工具 session_id 注入(自主调工具全链路)留 Phase 3.5 统一解决。 |
| 3.5 | 能力进化双环 + 能力库设置页 | ✅ | 2a7261b | 后端 capability.py(propose/list/approve/apply/rollback) + capability_eval.py(GOLDEN 0.85)；agent-service skill_propose/skill_apply 工具(skill_apply 受保护路径唯一写入口)；前端 settings/capabilities 页。**验证**：后端双环全链路（propose→list→apply未审批409→approve→apply评测1.0→提案v2→版本历史[1,2]→回滚v2→v1）；前端 SSR 200+typecheck；零新表（Artifact.type=skill/prompt + PendingChange.target_type=skill_change）。stub 12 绿。注：agent 自主调 skill 工具端到端依赖 session_id 注入（与 Phase 4 同源，收尾统一）。 |
| 5 | tooling 拆分 | ✅ | (待填) | internal/tooling/parse 用真实 detect/extract（类型识别+文本抽取，非LLM）；structured=true 额外 stub 结构化。consistency.double_run_consistent 加 mode：stub=strict(sha256严判)，pi=approx(结构Jaccard≥0.8，超预算不硬失败)。pipeline 按 provider 传 mode。验收：tooling/parse kind=txt+text；双模式单测；poc1 PASS；stub 12 绿。 |
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

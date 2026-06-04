# Pi 集成改造 · PRD/RTM 回填（Phase 8）

> 原则：只追加、不重写、上溯必填。RTM 边方向 `from=下游, to=上游, relation='derives'`。
> 本文档为本次「Pi 集成改造」新增的设计级需求条目，上溯到手册章节与既有需求。

## 新增 PRD 条目

### 功能需求（PRD-F-DSG-*）

| 编号 | 条目 | 上溯 | 落地 commit |
|---|---|---|---|
| PRD-F-DSG-01 | agent-service 内嵌 `@earendil-works/pi-agent-core`（in-process 多会话宿主） | 手册 §10③ | f3ba9fe (Phase 0) |
| PRD-F-DSG-02 | `core/llm.py` 新增 `pi` provider，默认 stub 兜底、pi 可选、失败回落 | 手册 §9 D1/D2 | 3f3bb7c (Phase 1) |
| PRD-F-DSG-03 | HTTP + WS 真 token 流式（backend 消费 agent-service WS） | 手册 §9 D3 | c194c2a (Phase 2) |
| PRD-F-DSG-04 | 能力进化双环 `skill_propose`/`skill_apply` + 版本化能力库 + 审批/回滚 | 手册 §15/§16 | 2a7261b (Phase 3.5) |
| PRD-F-DSG-05 | tooling 拆分（非 LLM 抽取 internal/tooling/parse + 双跑近似比对） | 手册 Phase 5 | 64ed2be (Phase 5) |

### 非功能需求（PRD-NFR-DSG-*）

| 编号 | 条目 | 上溯 | 落地 commit |
|---|---|---|---|
| PRD-NFR-DSG-01 | 容器化沙箱 + 密钥仅内存注入（不落盘/不进镜像层/不打日志） | 手册 §13 | bc785ec (Phase 6) |
| PRD-NFR-DSG-02 | 工具白名单 + 受保护路径 denylist（pathGuard，skill_apply 唯一写入口） | 手册 §16.2 | ae1876c (Phase 4) |
| PRD-NFR-DSG-03 | 确定性基线：CI 走 stub 严判（离线零依赖回归底线） | 手册 §9 D4 | 836a0ff (Phase 7) |
| PRD-NFR-DSG-04 | 能力变更回归评测门限 0.85（capability_eval 未达 apply 422） | 手册 §15.5 | 2a7261b (Phase 3.5) |

## RTM 边（from=下游, to=上游, relation='derives'）

```
PRD-F-DSG-01   → 手册§10③（Pi 内嵌架构）
PRD-F-DSG-02   → 手册§9 D1（多 provider）
PRD-F-DSG-03   → 手册§9 D3（真流式）
PRD-F-DSG-04   → 手册§15（能力进化双环）
PRD-F-DSG-05   → 手册 Phase 5（tooling 拆分）
PRD-NFR-DSG-01 → 手册§13（沙箱+密钥）
PRD-NFR-DSG-02 → 手册§16.2（工具白名单+denylist）
PRD-NFR-DSG-03 → 手册§9 D4（确定性基线）
PRD-NFR-DSG-04 → 手册§15.5（回归评测门限）
```

## 验收覆盖（Definition of Done 对照）

- [x] `LLM_PROVIDER=stub` 全套测试绿（离线零依赖回归底线）—— 每 Phase 12 项集成测试始终绿
- [x] `LLM_PROVIDER=pi` 端到端 资料→需求 跑通，agent-service 不可达自动回落 stub 不报 500
- [x] 前端收到 WS 真 token 流（非 `_chunks` 切片）—— SSE 29 个逐 token delta
- [x] HITL 三档 + 脱敏 + 审计闭环 —— Semi 档 deny 验证、redact 纯函数、DelegateAudit 落库
- [x] Agent 直接 `write .pi/skills/*` 被 pathGuard 拒绝；仅 skill_apply 能写入
- [x] 能力进化双环：propose→审批→apply→回滚 全链路可用
- [x] RTM 覆盖率 ≥ 0.85（pi 真实路径 healthScore=1.0）；PRD/RTM 回填完成（本文档）
- [~] `docker compose up` 一键起全栈 —— 配置就绪并静态校验，本机无 docker 未实跑

## 遗留/后续
- agent 自主调 internal/skill 工具的全链路需在工具调用时注入 session_id（当前三件套落库
  已由薄监督器可靠完成；自主工具调用的 session 上下文注入为后续增强）。
- 真实 pi 路径内容确定性受 LLM 影响；编号空间/上溯链/RTM 结构已规范，语义内容确定性可经
  更强 prompt 约束或低温进一步收敛。

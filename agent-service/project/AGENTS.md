# 工程约定（AGENTS）

## 编号空间
- 需求：ORD-* / CRD-* / PRD-F-* / PRD-NFR-*
- 设计：DSG-*    任务：T-*

## RTM
- 每个下游产物对上游建边：from=下游, to=上游, relation='derives'
- 阶段门：RTM 覆盖率 < 0.85 时禁止进入下一阶段（调 stage_gate_check）

## 增量·S2
- 修订既有文档时以 "### 增量·S2" 小节追加，保留历史编号

## 工具映射
- 结构化资料 → parse_material（非 LLM 部分）+ 内核推理
- 落库产物 → artifact_write    进度 → emit_task_event
- 委派 → delegate              能力改进 → skill_propose / skill_apply

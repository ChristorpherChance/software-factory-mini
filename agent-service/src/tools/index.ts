// 自定义工具注册表。
// Phase 0：空（Agent 无工具也能做对话/文本生成，验证 DeepSeek 接通）。
// Phase 3：注册 parse_material / artifact_write / stage_gate_check / emit_task_event / delegate。
// Phase 3.5：追加 skill_propose / skill_apply。
// read/write/edit/bash 由 harness/NodeExecutionEnv 提供，Phase 3/4 放开。
import type { AgentTool } from "@earendil-works/pi-agent-core";

export const allTools: AgentTool<any>[] = [];

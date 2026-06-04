// 自定义工具注册表。
// read/write/edit/bash 由 harness/NodeExecutionEnv 提供，Phase 4 放开（受 pathGuard 约束）。
// skill_propose/skill_apply 在 Phase 3.5 追加。
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { parseMaterialTool } from "./parseMaterial.js";
import { artifactWriteTool } from "./artifactWrite.js";
import { stageGateCheckTool } from "./stageGate.js";
import { emitTaskEventTool } from "./emitTaskEvent.js";
import { delegateTool } from "./delegate.js";
import { fileWriteTool } from "./fileWrite.js";
import { skillProposeTool, skillApplyTool } from "./skill.js";

export const allTools: AgentTool<any>[] = [
  parseMaterialTool,
  artifactWriteTool,
  stageGateCheckTool,
  emitTaskEventTool,
  delegateTool,
  fileWriteTool, // 受 pathGuard 约束（Phase 4）
  skillProposeTool, // 能力提案（不写盘，Phase 3.5）
  skillApplyTool, // 能力应用（受保护路径唯一写入口，Phase 3.5）
];

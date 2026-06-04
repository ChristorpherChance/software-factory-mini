// stage_gate_check：回调 FastAPI 校验 RTM 覆盖率门限并发 stage.gate 事件。
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { callBackend } from "../backend.js";
import { textResult } from "./helpers.js";

const Params = Type.Object({
  session_id: Type.String(),
  stage: Type.String({ description: "阶段名，如 requirement" }),
});

export const stageGateCheckTool: AgentTool<typeof Params> = {
  name: "stage_gate_check",
  label: "阶段门校验",
  description: "校验阶段门（RTM 覆盖率 ≥ 0.85），发 stage.gate 事件",
  parameters: Params,
  execute: async (_id, params: Static<typeof Params>) => {
    const r = await callBackend<{ stage: string; passed: boolean; score: number }>(
      "/api/v1/internal/stage/gate",
      params,
    );
    return textResult(
      `阶段门 ${r.stage}：${r.passed ? "通过" : "未通过"}（覆盖率 ${r.score}）`,
      r,
    );
  },
};

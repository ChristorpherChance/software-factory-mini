// delegate：复用后端 delegate/service.py（HITL+脱敏+降级链+审计）。
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { callBackend } from "../backend.js";
import { textResult } from "./helpers.js";

const Params = Type.Object({
  session_id: Type.String(),
  target: Type.String({ description: "委派目标，如 pi_subsession / claude_code / generic_http" }),
  payload: Type.Any(),
  hitl_mode: Type.Optional(Type.String()),
});

export const delegateTool: AgentTool<typeof Params> = {
  name: "delegate",
  label: "委派子任务",
  description: "委派子任务到外部 agent（经后端 delegate 抽象，含 HITL/脱敏/降级链/审计）",
  parameters: Params,
  execute: async (_id, params: Static<typeof Params>) => {
    const r = await callBackend<Record<string, unknown>>("/api/v1/internal/delegate", params);
    return textResult(`委派 ${params.target} 完成`, r);
  },
};

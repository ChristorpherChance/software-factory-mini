// parse_material：回调 Python tooling 端点做非 LLM 抽取（Phase 5 完善 OCR/分块）。
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { callBackend } from "../backend.js";
import { textResult } from "./helpers.js";

const Params = Type.Object({
  source: Type.String({ description: "资料文本/路径/URL" }),
  session_id: Type.Optional(Type.String()),
});

export const parseMaterialTool: AgentTool<typeof Params> = {
  name: "parse_material",
  label: "解析资料",
  description: "调 Python tooling 端点做非 LLM 抽取（类型识别/分块/就绪度评分）",
  parameters: Params,
  execute: async (_id, params: Static<typeof Params>) => {
    const r = await callBackend<Record<string, unknown>>("/api/v1/internal/tooling/parse", params);
    const score = (r as any).readiness_score ?? "?";
    return textResult(`资料已解析，就绪度 ${score}`, r);
  },
};

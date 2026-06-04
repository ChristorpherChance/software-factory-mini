// artifact_write：回调 FastAPI 落库 Artifact/Version + RTM 边 + publish artifact.created。
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { callBackend } from "../backend.js";
import { textResult } from "./helpers.js";

const Params = Type.Object({
  session_id: Type.String(),
  kind: Type.String({ description: "ord|crd|prd|skill|prompt 等工件类型" }),
  name: Type.String(),
  content: Type.String({ description: "完整 Markdown 正文" }),
  upstream_ids: Type.Optional(Type.Array(Type.String())),
});

export const artifactWriteTool: AgentTool<typeof Params> = {
  name: "artifact_write",
  label: "落库工件",
  description: "落库 Artifact/ArtifactVersion + RTM 节点/边，并扇出 artifact.created 事件",
  parameters: Params,
  execute: async (_id, params: Static<typeof Params>) => {
    const r = await callBackend<{ artifact_id: string; version: number }>(
      "/api/v1/internal/artifact/write",
      params,
    );
    return textResult(`已落库 ${params.kind} 工件 v${r.version}（${r.artifact_id}）`, r);
  },
};

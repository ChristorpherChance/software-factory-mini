// emit_task_event：回调 FastAPI 扇出 task.update 进度事件。
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { callBackend } from "../backend.js";
import { textResult } from "./helpers.js";

const Params = Type.Object({
  session_id: Type.String(),
  pct: Type.Number({ description: "进度百分比 0~100" }),
  note: Type.Optional(Type.String()),
});

export const emitTaskEventTool: AgentTool<typeof Params> = {
  name: "emit_task_event",
  label: "进度事件",
  description: "扇出 task.update 进度事件",
  parameters: Params,
  execute: async (_id, params: Static<typeof Params>) => {
    await callBackend("/api/v1/internal/events/task", params);
    return textResult(`进度 ${params.pct}% ${params.note ?? ""}`, params);
  },
};

// 工具公共辅助：构造 AgentToolResult。
import type { AgentToolResult } from "@earendil-works/pi-agent-core";

/** 文本结果（details 存原始数据，供 UI/日志）。 */
export function textResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

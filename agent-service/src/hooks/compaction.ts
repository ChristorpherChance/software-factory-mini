// transformContext：需求文档感知的上下文压缩。
// 真实签名：(messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>
// 策略：消息不多时原样返回；超阈值时保留 system + 最近 12 条 +
//       任何含 ORD-/CRD-/PRD-/RTM 的消息（产物/追溯不可丢）。
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const KEEP_RECENT = 12;
const SOFT_LIMIT = 40; // 低于此数不压缩
const TRACE_RE = /(ORD-|CRD-|PRD-|RTM)/;

function messageText(m: AgentMessage): string {
  const anyMsg = m as any;
  const c = anyMsg?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((b: any) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : ""))
      .join(" ");
  }
  return "";
}

export async function customCompaction(
  messages: AgentMessage[],
  _signal?: AbortSignal,
): Promise<AgentMessage[]> {
  if (!Array.isArray(messages) || messages.length <= SOFT_LIMIT) return messages;
  const recent = messages.slice(-KEEP_RECENT);
  const recentSet = new Set(recent);
  const traceKept = messages.filter((m) => !recentSet.has(m) && TRACE_RE.test(messageText(m)));
  // 顺序：含追溯的历史消息 + 最近窗口（system 由 Agent 单独持有，不在 messages 里）
  return [...traceKept, ...recent];
}

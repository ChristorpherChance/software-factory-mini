// 软件工厂缩小版 · ToolCall store（第 7 域，不破坏现有 6 域）
// 接收 SSE tool.call 事件落地。按 msgId 聚合（无 msgId 时落到 "_global"）。
import { create } from "zustand";

export interface ToolCall {
  id: string;
  name: string;
  status: "queued" | "running" | "ok" | "error";
  duration_ms?: number;
  tokens?: number;
  hitl?: boolean;
  input_preview?: string;
  error?: string;
}

interface ToolCallState {
  /** Record<msgId|"_global", ToolCall[]>，按调用 id upsert。 */
  byMsg: Record<string, ToolCall[]>;
  /** SSE tool.call：upsert（按 id 替换或追加）。 */
  upsert: (msgId: string | null | undefined, call: ToolCall) => void;
  /** 切换会话/重连时清空。 */
  reset: () => void;
}

export const useToolCallStore = create<ToolCallState>((set) => ({
  byMsg: {},
  upsert: (msgId, call) =>
    set((s) => {
      const key = msgId || "_global";
      const list = s.byMsg[key] ?? [];
      const i = list.findIndex((c) => c.id === call.id);
      const next = i >= 0
        ? list.map((c, idx) => (idx === i ? { ...c, ...call } : c))
        : [...list, call];
      return { byMsg: { ...s.byMsg, [key]: next } };
    }),
  reset: () => set({ byMsg: {} }),
}));

// 软件工厂缩小版 · 会话 store（消息流 + SSE 连接态 + HITL 待定）
import { create } from "zustand";

export interface ChatMsg {
  id: string;
  role: string;
  content: string;
  streaming?: boolean;
  pendingChangeId?: string;
  pendingCount?: number;
  /** M4 P1-B：思考过程（C 档；现有 stub 不产出，预留字段供未来填充）。 */
  thinking?: string;
}

export type ConnState = "open" | "reconnecting" | "closed";

interface SessionState {
  sid: string | null;
  messages: ChatMsg[];
  connState: ConnState;
  /** 设置当前会话 id。 */
  setSid: (sid: string | null) => void;
  /** 用历史消息整体填充消息流。 */
  hydrate: (msgs: ChatMsg[]) => void;
  /** 追加一条用户/本地消息。 */
  push: (msg: ChatMsg) => void;
  /** SSE message.delta：增量逐 token 拼接（消息不存在则新建 assistant 消息）。 */
  appendDelta: (id: string, delta: string) => void;
  /** SSE message.end：结束流式态。 */
  finalize: (id: string) => void;
  /** SSE hitl.request：把 pending 信息挂到对应消息上。 */
  raiseHitl: (data: {
    pending_change_id: string;
    msg_id?: string;
    kind?: string;
    count?: number;
  }) => void;
  /** 切换 SSE 连接态。 */
  setConnState: (s: ConnState) => void;
  /** 清空（切换会话时）。 */
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sid: null,
  messages: [],
  connState: "closed",
  setSid: (sid) => set({ sid }),
  hydrate: (messages) => set({ messages }),
  push: (msg) => set((st) => ({ messages: [...st.messages, msg] })),
  appendDelta: (id, delta) =>
    set((st) => {
      const i = st.messages.findIndex((m) => m.id === id);
      if (i < 0) {
        return {
          messages: [
            ...st.messages,
            { id, role: "assistant", content: delta, streaming: true },
          ],
        };
      }
      const copy = [...st.messages];
      copy[i] = { ...copy[i], content: copy[i].content + delta, streaming: true };
      return { messages: copy };
    }),
  finalize: (id) =>
    set((st) => ({
      messages: st.messages.map((m) => (m.id === id ? { ...m, streaming: false } : m)),
    })),
  raiseHitl: (data) =>
    set((st) => {
      // 优先挂到指定消息，否则挂到最后一条 assistant 消息
      let targetId = data.msg_id;
      if (!targetId) {
        const last = [...st.messages].reverse().find((m) => m.role === "assistant");
        targetId = last?.id;
      }
      if (!targetId) return {};
      return {
        messages: st.messages.map((m) =>
          m.id === targetId
            ? {
                ...m,
                pendingChangeId: data.pending_change_id,
                pendingCount: data.count ?? 1,
              }
            : m
        ),
      };
    }),
  setConnState: (connState) => set({ connState }),
  reset: () => set({ messages: [], connState: "closed" }),
}));

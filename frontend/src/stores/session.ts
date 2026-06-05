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
  /** SSE message.delta(channel=reasoning)：思考链增量，拼到 thinking（折叠区显示）。 */
  appendThinking: (id: string, delta: string) => void;
  /** SSE message.end：结束流式态。 */
  finalize: (id: string) => void;
  /** 用户点「停止」：立即停掉该消息流式态，并忽略其后续 SSE 增量（问题1 立即停止、不再输出）。 */
  cancelStream: (id: string) => void;
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

export const useSessionStore = create<SessionState & { stopped: Record<string, boolean> }>((set) => ({
  sid: null,
  messages: [],
  connState: "closed",
  // 已停止的消息 id（内存态，切会话清空）；停止后 appendDelta 直接忽略其增量
  stopped: {},
  setSid: (sid) => set({ sid }),
  hydrate: (messages) => set({ messages }),
  push: (msg) => set((st) => ({ messages: [...st.messages, msg] })),
  appendDelta: (id, delta) =>
    set((st) => {
      // 已被用户停止的消息：忽略后续增量，保持已输出内容不再增长（问题1）
      if (st.stopped[id]) return {};
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
  appendThinking: (id, delta) =>
    set((st) => {
      if (st.stopped[id]) return {};
      const i = st.messages.findIndex((m) => m.id === id);
      if (i < 0) {
        // 思考链可能先于正文到达：先建一条空正文的 assistant 消息承载 thinking
        return {
          messages: [
            ...st.messages,
            { id, role: "assistant", content: "", thinking: delta, streaming: true },
          ],
        };
      }
      const copy = [...st.messages];
      copy[i] = { ...copy[i], thinking: (copy[i].thinking ?? "") + delta, streaming: true };
      return { messages: copy };
    }),
  finalize: (id) =>
    set((st) => ({
      messages: st.messages.map((m) => (m.id === id ? { ...m, streaming: false } : m)),
    })),
  cancelStream: (id) =>
    set((st) => ({
      stopped: { ...st.stopped, [id]: true },
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
  reset: () => set({ messages: [], connState: "closed", stopped: {} }),
}));

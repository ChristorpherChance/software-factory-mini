// 软件工厂缩小版 · 当前主区工件目标 store（问题2：对话定向编辑需定位目标工件）
// RequirementView 在切 section/工件时写入；ChatPanel 发送对话消息时读取并随 api.send 透传。
import { create } from "zustand";

interface EditTargetState {
  /** 当前主区工件类型（crd|prd），无则 null。 */
  targetType: string | null;
  /** 当前主区工件 id，无则 null。 */
  targetArtifactId: string | null;
  setTarget: (type: string | null, id: string | null) => void;
  /**
   * 划选引用片段（问题3）：RequirementView 在文档里划选文本后 setQuote 写入；
   * ChatPanel 读取显示「引用 chip」，发送时随 api.send 透传并清空（setQuote(null)）。
   */
  quoteText: string | null;
  setQuote: (t: string | null) => void;
}

export const useEditTargetStore = create<EditTargetState>((set) => ({
  targetType: null,
  targetArtifactId: null,
  setTarget: (targetType, targetArtifactId) => set({ targetType, targetArtifactId }),
  quoteText: null,
  setQuote: (quoteText) => set({ quoteText }),
}));

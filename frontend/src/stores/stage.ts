// 软件工厂缩小版 · 阶段状态 store（L2 导航点状图标）
import { create } from "zustand";

export type StageDot = "todo" | "doing" | "done" | "fail";

interface StageState {
  status: Record<string, StageDot>;
  setStatus: (key: string, dot: StageDot) => void;
}

export const useStageStore = create<StageState>((set) => ({
  // 本期仅 material / requirement 可用
  status: { material: "doing", requirement: "todo" },
  setStatus: (key, dot) =>
    set((s) => ({ status: { ...s.status, [key]: dot } })),
}));

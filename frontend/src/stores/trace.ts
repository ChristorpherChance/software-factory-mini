// 软件工厂缩小版 · 追溯健康度 store（TopBar 🔗 徽标读取）
import { create } from "zustand";

interface Coverage {
  L0a: number;
  L0b: number;
  L0c: number;
}

interface TraceState {
  healthScore: number;
  coverage: Coverage;
  /** 由 matrix/requirement 加载 RTM 报告后 hydrate。 */
  hydrate: (r: {
    healthScore?: number;
    L0a?: number;
    L0b?: number;
    L0c?: number;
  }) => void;
}

export const useTraceStore = create<TraceState>((set) => ({
  healthScore: 0,
  coverage: { L0a: 0, L0b: 0, L0c: 0 },
  hydrate: (r) =>
    set({
      healthScore: r.healthScore ?? 0,
      coverage: { L0a: r.L0a ?? 0, L0b: r.L0b ?? 0, L0c: r.L0c ?? 0 },
    }),
}));

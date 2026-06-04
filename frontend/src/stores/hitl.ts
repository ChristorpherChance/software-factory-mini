// 软件工厂缩小版 · HITL 档位 store
import { create } from "zustand";
import type { HitlMode } from "@/lib/hitl";

interface HitlState {
  mode: HitlMode;
  setMode: (m: HitlMode) => void;
}

export const useHitlStore = create<HitlState>((set) => ({
  mode: "Semi",
  setMode: (mode) => set({ mode }),
}));

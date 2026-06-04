// 软件工厂缩小版 · 工件 store（SSE artifact.created 记录最近生成的工件）
import { create } from "zustand";

interface ArtifactState {
  created: string[];
  /** SSE artifact.created：记录新生成的工件 url/id。 */
  markCreated: (url: string) => void;
  reset: () => void;
}

export const useArtifactStore = create<ArtifactState>((set) => ({
  created: [],
  markCreated: (url) => set((s) => ({ created: [...s.created, url] })),
  reset: () => set({ created: [] }),
}));

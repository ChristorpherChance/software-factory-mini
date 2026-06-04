// 软件工厂缩小版 · 设置 store
// - 内联徽章读取 model / endpoint
// - 外壳 UI 偏好：chatWidth (320-640 钳制) + l2Collapsed
// 偏好持久化到 localStorage，跨路由重挂保持
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface SettingState {
  // 从后端设置 hydrate（不持久化，每次 mount 走 useQuery）
  model?: { name?: string };
  endpoint?: { name?: string };
  hydrate: (cfg: any) => void;

  // UI 偏好（持久化）
  chatWidth: number;
  setChatWidth: (w: number) => void;
  l2Collapsed: boolean;
  toggleL2: () => void;
}

export const useSettingStore = create<SettingState>()(
  persist(
    (set) => ({
      model: undefined,
      endpoint: undefined,
      hydrate: (cfg) => set({ model: cfg?.model, endpoint: cfg?.endpoint }),

      chatWidth: 404,
      setChatWidth: (w) =>
        set({ chatWidth: Math.min(640, Math.max(320, w)) }),

      l2Collapsed: false,
      toggleL2: () => set((s) => ({ l2Collapsed: !s.l2Collapsed })),
    }),
    {
      name: "sf-setting-ui",
      storage: createJSONStorage(() => localStorage),
      // 只持久化 UI 偏好，model/endpoint 始终走 hydrate
      partialize: (s) => ({
        chatWidth: s.chatWidth,
        l2Collapsed: s.l2Collapsed,
      }),
    }
  )
);

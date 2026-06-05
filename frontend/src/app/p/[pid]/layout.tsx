"use client";

import { Suspense } from "react";
import { UserRound } from "lucide-react";
import { TopBar } from "@/components/shell/TopBar";
import { L1Projects } from "@/components/shell/L1Projects";
import { L2Stages } from "@/components/shell/L2Stages";
import { ChatPanel } from "@/components/shell/ChatPanel";
import { useSettingStore } from "@/stores/setting";

// 五区栅格外壳：
// 行：56px TopBar / 1fr 主体（与原型一致）
// 列：60px L1 / var(--l2-w) L2 / 1fr 主内容 / var(--chat-w) 对话区
// - L2 折叠态宽度切换（248 ↔ 72）由 useSettingStore.l2Collapsed 驱动
// - 对话区宽度由 useSettingStore.chatWidth 驱动（持久化、跨路由保持）
// - 对话区收拢态（问题4）：chatCollapsed 时对话列宽 0 且不渲染 ChatPanel，
//   改在右下角渲染悬浮「小人」按钮展开；chatWidth 不变，展开后拖拽调宽不受影响。
export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  const chatWidth = useSettingStore((s) => s.chatWidth);
  const l2Collapsed = useSettingStore((s) => s.l2Collapsed);
  const chatCollapsed = useSettingStore((s) => s.chatCollapsed);
  const setChatCollapsed = useSettingStore((s) => s.setChatCollapsed);
  const l2w = l2Collapsed ? 72 : 248;
  // 收拢时对话列宽归 0；展开时用持久化的 chatWidth
  const chatW = chatCollapsed ? 0 : chatWidth;

  return (
    <div className="grid h-screen grid-rows-[56px_minmax(0,1fr)] bg-bg-subtle">
      <TopBar />
      <div
        className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden"
        style={{
          gridTemplateColumns: `60px ${l2w}px minmax(0, 1fr) ${chatW}px`,
        }}
      >
        <L1Projects />
        <L2Stages />
        <main className="overflow-auto border-x border-border bg-bg">{children}</main>
        {/* 收拢时整列 0 且不渲染 ChatPanel，避免其拖拽手柄/内容溢出 */}
        {!chatCollapsed && (
          // ChatPanel 内部使用 useSearchParams，需 Suspense 包裹
          <Suspense
            fallback={
              <section className="flex items-center justify-center bg-bg-elevated text-sm text-text-muted">
                加载会话…
              </section>
            }
          >
            <ChatPanel />
          </Suspense>
        )}
      </div>

      {/* 收拢态：右下角悬浮「简笔小人」头像按钮，点击展开对话 */}
      {chatCollapsed && (
        <button
          onClick={() => setChatCollapsed(false)}
          title="展开对话"
          aria-label="展开对话"
          className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary bg-bg-elevated text-primary shadow-lg transition-colors hover:bg-primary-subtle"
        >
          <UserRound className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}

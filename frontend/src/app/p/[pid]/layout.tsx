"use client";

import { Suspense } from "react";
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
export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  const chatWidth = useSettingStore((s) => s.chatWidth);
  const l2Collapsed = useSettingStore((s) => s.l2Collapsed);
  const l2w = l2Collapsed ? 72 : 248;

  return (
    <div className="grid h-screen grid-rows-[56px_minmax(0,1fr)] bg-bg-subtle">
      <TopBar />
      <div
        className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden"
        style={{
          gridTemplateColumns: `60px ${l2w}px minmax(0, 1fr) ${chatWidth}px`,
        }}
      >
        <L1Projects />
        <L2Stages />
        <main className="overflow-auto border-x border-border bg-bg">{children}</main>
        {/* ChatPanel 内部使用 useSearchParams，需 Suspense 包裹 */}
        <Suspense
          fallback={
            <section className="flex items-center justify-center bg-bg-elevated text-sm text-text-muted">
              加载会话…
            </section>
          }
        >
          <ChatPanel />
        </Suspense>
      </div>
    </div>
  );
}

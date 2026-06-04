"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ToolCall } from "@/stores/toolcall";
import { cn } from "@/lib/utils";

// 工具调用卡（M4 P1-B 壳 + SSE）：照搬原型 ToolCallCard
// - 橙边 + STATUS_ICON
// - 展开看入参预览
// - stub 模式没有 tool_use 路径 → 天然空态（store 没填则不渲染）
// - 真实 Anthropic key 走 _anthropic_* → SSE tool.call(running→ok)

const STATUS_ICON: Record<ToolCall["status"], string> = {
  queued: "⏳",
  running: "▶",
  ok: "✓",
  error: "✗",
};

export function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);

  const accent = call.status === "ok"
    ? "text-success"
    : call.status === "error"
      ? "text-error"
      : "text-warning";

  return (
    <div className="overflow-hidden rounded-md border border-[#EA580C] bg-bg">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 bg-[#FFF7ED] px-2.5 py-2 dark:bg-[#2A1A0E]"
      >
        <span className="flex items-center gap-1.5">
          <span className={accent}>{STATUS_ICON[call.status]}</span>
          <span className="text-xs font-semibold text-[#9A3412] dark:text-[#FDBA74]">
            {call.name}
          </span>
        </span>
        <span className="flex items-center gap-1 text-[11px] text-[#C2410C] dark:text-[#FB923C]">
          {call.duration_ms != null ? `${(call.duration_ms / 1000).toFixed(1)}s` : ""}
          {call.tokens != null ? ` · ${call.tokens} tok` : ""}
          <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        </span>
      </button>

      {open && (
        <div className="space-y-1 px-2.5 py-2 text-[11px] leading-relaxed text-text-secondary">
          {call.input_preview && <div>入参: {call.input_preview}</div>}
          {call.hitl && <div>HITL: 需确认</div>}
          {call.error && <div className="text-error">错误：{call.error}</div>}
        </div>
      )}
    </div>
  );
}

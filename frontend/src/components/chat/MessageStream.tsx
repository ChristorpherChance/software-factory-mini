"use client";

import { memo, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { useToolCallStore } from "@/stores/toolcall";
import { PendingActions } from "@/components/chat/PendingActions";
import { ToolCallCard } from "@/components/chat/ToolCallCard";
import { cn } from "@/lib/utils";

// 助手消息气泡（性能关键：修复大文档生成时全页面卡死）。
// - streaming 中：用纯文本渲染（whitespace-pre-wrap），避免每来一段增量就把
//   不断变长的整篇 markdown 重新解析一次（O(n²) 主线程阻塞 → 卡死）。
// - streaming 结束：用 ReactMarkdown 渲染一次；外层 memo 保证后续无关重渲染
//   （如 pending 轮询每 4s）不再重复解析整篇。
const AssistantBubble = memo(function AssistantBubble({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className="inline-block max-w-[90%] rounded-lg bg-bg-subtle px-3 py-2 text-left">
      {streaming ? (
        <div className="whitespace-pre-wrap text-sm text-text">
          {content}
          <span className="ml-0.5 animate-pulse">▋</span>
        </div>
      ) : (
        <article className="prose prose-sm max-w-none text-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      )}
    </div>
  );
});

// 消息流：
// - 历史消息：user / assistant + thinking 折叠（C 档）+ inline ToolCallCard（按 msg_id 关联）
// - 流尾部：未挂到具体消息的"全局" pendings 直接列在最后（兜底，确保 reload 后也可见）
// - 全局 ToolCall（_global 桶，stub 模式天然为空）
export function MessageStream() {
  const { pid } = useParams<{ pid: string }>();
  const messages = useSessionStore((s) => s.messages);
  const byMsg = useToolCallStore((s) => s.byMsg);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, byMsg]);

  // 全局 pending（兜底）：reload 后 session 历史不带 pendingChangeId，
  // 直接拉项目 pending 列表挂在流尾，确保 PendingActions 总能呈现
  const { data: pendings } = useQuery({
    queryKey: ["pending-changes", pid, "pending"],
    queryFn: () => api.pendingChanges(pid, "pending"),
    enabled: !!pid,
    refetchInterval: 4000,
  });

  // 已挂在 message 上的 pending id 集合（避免重复渲染）
  const attached = new Set(messages.map((m) => m.pendingChangeId).filter(Boolean));
  const orphanPendings = (pendings ?? []).filter((p) => !attached.has(p.id));

  return (
    <div className="sf-scroll flex-1 space-y-3 overflow-auto p-3">
      {messages.length === 0 && (
        <p className="pt-6 text-center text-sm text-text-muted">
          还没有消息。试试发送「生成 ORD」或描述你的诉求。
        </p>
      )}
      {messages.map((m) => {
        const isUser = m.role === "user";
        const calls = byMsg[m.id] ?? [];
        return (
          <div key={m.id} className={cn("space-y-2", isUser && "text-right")}>
            {isUser ? (
              // user 消息：纯文本气泡（保持简洁）
              <div className="inline-block max-w-[90%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-left text-sm text-white">
                {m.content}
                {m.streaming && <span className="ml-0.5 animate-pulse">▋</span>}
              </div>
            ) : (
              // assistant 消息：流式中纯文本、完成后 Markdown（AssistantBubble 内部处理，避免大文档卡死）
              <AssistantBubble content={m.content} streaming={m.streaming} />
            )}

            {/* 思考过程折叠（thinking 非空才渲染 · C 档） */}
            {!isUser && m.thinking && (
              <details className="block rounded-md bg-bg-subtle px-2.5 py-2 text-left">
                <summary className="cursor-pointer text-xs font-medium text-text-muted">
                  🧠 思考过程（点击展开）
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-text-secondary">
                  {m.thinking}
                </p>
              </details>
            )}

            {/* 工具调用卡（按 msg_id 关联；本批后端尚未带 msg_id，多落 _global，下方单独渲染） */}
            {calls.map((c) => (
              <ToolCallCard key={c.id} call={c} />
            ))}

            {/* HITL pending 4 按钮 + YNRD（实时挂到消息上） */}
            {m.pendingChangeId && (
              <PendingActions cid={m.pendingChangeId} count={m.pendingCount ?? 0} />
            )}
          </div>
        );
      })}

      {/* 全局 pending（兜底渲染：reload 后历史消息无 pendingChangeId 时也能看到 4 按钮+YNRD） */}
      {orphanPendings.map((p) => (
        <PendingActions
          key={p.id}
          cid={p.id}
          count={(p.diffBlocks ?? []).length || 1}
        />
      ))}

      {/* 全局 ToolCall（_global 桶，stub 模式天然为空） */}
      {(byMsg._global ?? []).map((c) => (
        <ToolCallCard key={c.id} call={c} />
      ))}

      <div ref={bottom} />
    </div>
  );
}

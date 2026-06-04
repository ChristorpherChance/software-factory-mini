"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// 渲染后端 unified diff：绿增 / 红删 / 灰上下文
export function DiffView({
  aid,
  from,
  to,
}: {
  aid: string;
  from: number;
  to: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["diff", aid, from, to],
    queryFn: () => api.diff(aid, from, to),
  });

  if (isLoading) {
    return <p className="text-sm text-text-muted">加载 diff…</p>;
  }

  const lines = data?.lines ?? [];
  if (lines.length === 0) {
    return <p className="text-sm text-text-muted">v{from} 与 v{to} 无差异。</p>;
  }

  return (
    <pre className="overflow-auto rounded-md bg-text p-3 text-xs leading-relaxed sf-scroll">
      {lines.map((ln, i) => {
        const cls = ln.startsWith("+")
          ? "text-[var(--diff-add)]"
          : ln.startsWith("-")
          ? "text-[var(--diff-del)]"
          : "text-bg/60";
        return (
          <div key={i} className={cn(cls)}>
            {ln || " "}
          </div>
        );
      })}
    </pre>
  );
}

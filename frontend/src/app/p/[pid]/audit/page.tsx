"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const DOT: Record<string, string> = {
  succeeded: "text-success",
  failed: "text-error",
  running: "text-primary",
  pending: "text-text-muted",
};

export default function AuditPage() {
  const { pid } = useParams<{ pid: string }>();
  const { data: audits, isLoading } = useQuery({
    queryKey: ["audits", pid],
    queryFn: () => api.delegateAudits(pid),
    enabled: !!pid,
  });

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold text-text">委派审计</h2>
      {isLoading ? (
        <p className="text-sm text-text-muted">加载审计…</p>
      ) : (audits ?? []).length === 0 ? (
        <p className="text-sm text-text-muted">暂无委派记录。</p>
      ) : (
        <ul className="space-y-2">
          {(audits ?? []).map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated p-2 text-sm"
            >
              <span className="font-mono text-text">{a.target}</span>
              <span className={cn(DOT[a.status] ?? "text-text-secondary")}>
                {a.status}
              </span>
              <span className="text-text-muted">
                {a.latencyMs != null ? `${a.latencyMs} ms` : "-"}
              </span>
              <span className="text-xs text-text-muted">
                {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

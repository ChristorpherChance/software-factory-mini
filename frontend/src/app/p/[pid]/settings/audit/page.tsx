"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export default function SettingAuditPage() {
  const { pid } = useParams<{ pid: string }>();
  const { data: rows, isLoading } = useQuery({
    queryKey: ["setting-audit", pid],
    queryFn: () => api.settingAudit(pid),
    enabled: !!pid,
  });

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold text-text">设置变更审计</h2>
      {isLoading ? (
        <p className="text-sm text-text-muted">加载审计…</p>
      ) : (rows ?? []).length === 0 ? (
        <p className="text-sm text-text-muted">暂无变更记录。</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {(rows ?? []).map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1.5"
            >
              <span className="font-mono text-text">
                {r.category}.{r.key}
              </span>
              <span className="text-text-secondary">
                {JSON.stringify(r.oldValue)} → {JSON.stringify(r.newValue)}
              </span>
              <span className="text-xs text-text-muted">
                {r.actor} · {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

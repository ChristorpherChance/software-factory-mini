"use client";

import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// 状态机：todo→in_progress→done；blocked→in_progress
const NEXT: Record<string, string> = {
  todo: "in_progress",
  in_progress: "done",
  blocked: "in_progress",
};

const BADGE: Record<string, string> = {
  todo: "bg-bg-subtle text-text-secondary",
  in_progress: "bg-primary-subtle text-primary",
  blocked: "bg-error-subtle text-error",
  done: "bg-success-subtle text-success",
  cancelled: "bg-bg-subtle text-text-muted",
};

export default function TasksPage() {
  const { pid } = useParams<{ pid: string }>();
  const qc = useQueryClient();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", pid],
    queryFn: () => api.tasks(pid),
    enabled: !!pid,
  });

  const move = useMutation({
    mutationFn: ({ id, to, version }: { id: string; to: string; version: number }) =>
      api.transition(id, to, version),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", pid] }),
  });

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold text-text">Task 列表</h2>
      {isLoading ? (
        <p className="text-sm text-text-muted">加载 Task…</p>
      ) : (tasks ?? []).length === 0 ? (
        <p className="text-sm text-text-muted">暂无 Task。</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-text-muted">
            <tr>
              <th className="py-1">编号</th>
              <th>标题</th>
              <th>状态</th>
              <th>预估</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(tasks ?? []).map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="py-1.5 font-mono text-xs text-text-secondary">{t.code}</td>
                <td className="text-text">{t.title}</td>
                <td>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      BADGE[t.status] ?? "bg-bg-subtle text-text-secondary"
                    )}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="text-text-secondary">
                  {t.estimate != null ? `${t.estimate}d` : "-"}
                </td>
                <td>
                  {NEXT[t.status] && (
                    <button
                      onClick={() =>
                        move.mutate({ id: t.id, to: NEXT[t.status], version: t.version })
                      }
                      disabled={move.isPending}
                      className="text-xs text-primary hover:underline"
                    >
                      → {NEXT[t.status]}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

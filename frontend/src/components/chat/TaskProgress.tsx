"use client";

import { useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Play, Hourglass, ChevronDown } from "lucide-react";
import { api, type TaskDto } from "@/lib/api";
import { useTaskStore } from "@/stores/task";
import { cn } from "@/lib/utils";

// Task 进度（照搬原型 TaskProgress 视觉）
// - 三组：已完成 / 进行中 / 等待中
// - 真实数据：api.tasks(pid) (B 档)；SSE task.update 通过 useTaskStore 覆盖实时状态 (A 档)
// 后端 status → 三组映射：
//   done                              → done
//   in_progress | running             → in_progress
//   todo | blocked | cancelled | rest → waiting

type Group = "done" | "in_progress" | "waiting";

function mapStatus(s?: string): Group {
  if (s === "done" || s === "succeeded" || s === "approved") return "done";
  if (s === "in_progress" || s === "running") return "in_progress";
  return "waiting";
}

const GROUPS: { key: Group; label: string }[] = [
  { key: "done", label: "已完成" },
  { key: "in_progress", label: "进行中" },
  { key: "waiting", label: "等待中" },
];

function StateIcon({ state }: { state: Group }) {
  if (state === "done") return <Check className="h-3.5 w-3.5 text-success" />;
  if (state === "in_progress") return <Play className="h-3.5 w-3.5 text-primary" />;
  return <Hourglass className="h-3.5 w-3.5 text-text-muted" />;
}

function Row({
  title,
  state,
  meta,
  action,
}: {
  title: string;
  state: Group;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5",
        state === "in_progress" && "bg-primary-subtle"
      )}
    >
      <StateIcon state={state} />
      <span
        className={cn(
          "flex-1 truncate text-xs",
          state === "done" ? "text-text-muted line-through" : "text-text"
        )}
      >
        {title}
      </span>
      {meta && (
        <span
          className={cn(
            "text-[10px]",
            state === "in_progress" ? "text-primary" : "text-text-muted"
          )}
        >
          {meta}
        </span>
      )}
      {action}
    </div>
  );
}

export function TaskProgress() {
  const { pid } = useParams<{ pid: string }>();
  const [open, setOpen] = useState(true);
  const runtimeTasks = useTaskStore((s) => s.tasks);
  const qc = useQueryClient();

  // 推进 Task：todo/blocked → in_progress → done（乐观锁 If-Match=version）
  const advance = useMutation({
    mutationFn: ({ id, to, version }: { id: string; to: string; version: number }) =>
      api.transition(id, to, version),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", pid] }),
  });

  // 真实 task 列表
  const { data: list } = useQuery({
    queryKey: ["tasks", pid],
    queryFn: () => api.tasks(pid),
    enabled: !!pid,
    refetchInterval: 5000, // 简单轮询；SSE task.update 同步 store，二者互补
  });

  const tasks: TaskDto[] = list ?? [];

  // 合并 SSE runtime（in_progress/progress 等会覆盖 db 状态）
  const enriched = tasks.map((t) => {
    const rt = runtimeTasks[t.id];
    const status = rt?.status ?? t.status;
    const meta =
      rt?.progress != null ? `${rt.progress}%` : t.estimate ? `${t.estimate}h` : undefined;
    return { ...t, status, _meta: meta, _dbStatus: t.status };
  });

  const done = enriched.filter((t) => mapStatus(t.status) === "done").length;
  const total = enriched.length;

  // 没有任何 task 时直接不渲染（避免占空间）
  if (total === 0) return null;

  return (
    <div className="border-b border-border bg-bg-elevated px-3.5 py-2.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-text">📋 Task 进度</span>
          <span className="rounded-full bg-primary-subtle px-1.5 py-0.5 text-[11px] font-semibold text-primary">
            {done} / {total}
          </span>
        </span>
        <span className="flex items-center gap-1 text-[11px] text-text-muted">
          {open ? "收起" : "展开"}
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")}
          />
        </span>
      </button>

      {open && (
        <div className="mt-1.5 space-y-0.5">
          {GROUPS.map((g) => {
            const items = enriched.filter((t) => mapStatus(t.status) === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key}>
                <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold text-text-muted">
                  {g.label}
                </div>
                {items.map((t) => {
                  const dbStatus = (t as any)._dbStatus as string;
                  const adv =
                    dbStatus === "todo" || dbStatus === "blocked"
                      ? { to: "in_progress", Icon: Play, title: "开始" }
                      : dbStatus === "in_progress"
                        ? { to: "done", Icon: Check, title: "完成" }
                        : null;
                  const AdvIcon = adv?.Icon;
                  return (
                    <Row
                      key={t.id}
                      title={t.title}
                      state={g.key}
                      meta={(t as any)._meta}
                      action={
                        adv && AdvIcon ? (
                          <button
                            onClick={() =>
                              advance.mutate({ id: t.id, to: adv.to, version: t.version })
                            }
                            disabled={advance.isPending}
                            title={adv.title}
                            className="flex h-5 w-5 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-bg-subtle hover:text-primary group-hover:opacity-100 disabled:opacity-50"
                          >
                            <AdvIcon className="h-3 w-3" />
                          </button>
                        ) : undefined
                      }
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

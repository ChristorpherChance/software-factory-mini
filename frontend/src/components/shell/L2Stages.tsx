"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import {
  Network,
  ListChecks,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useStageStore } from "@/stores/stage";
import { useSettingStore } from "@/stores/setting";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  STAGES,
  STATUS_GLYPH,
  STATUS_COLOR,
  mapDotToStatus,
  type Stage,
  type StageStatus,
} from "@/lib/stages";
import { cn } from "@/lib/utils";

// L2 阶段导航：双态折叠（248 ↔ 72）+ 序号 + emoji + 进度条 + 图例 + 工具区
// - material / requirement 状态接 useStageStore (A 档)；其余 11 阶段静态 (C 档)
// - 导航保留 Next.js 路由：可点阶段用 <Link>，灰显阶段用 <div title>

/** 用 stageStore 覆盖 material/requirement 的真实状态；其余阶段维持静态。 */
function useEnrichedStages(): Stage[] {
  const status = useStageStore((s) => s.status);
  return STAGES.map((st) => {
    if (st.key === "material" || st.key === "requirement") {
      const live: StageStatus = mapDotToStatus(status[st.key]);
      const progress =
        live === "finalized" ? 100 :
        live === "in_progress" ? Math.max(st.progress, 30) :
        live === "failed" ? 0 : 0;
      return { ...st, status: live, progress };
    }
    return st;
  });
}

function StatusDot({ status }: { status: StageStatus }) {
  return (
    <span className={cn("text-[13px]", STATUS_COLOR[status])}>
      {STATUS_GLYPH[status]}
    </span>
  );
}

function ExpandedRow({ stage, pid, active }: { stage: Stage; pid: string; active: boolean }) {
  const dim = !stage.available;
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-[11px] font-semibold",
            dim ? "text-text-muted" : "text-text-secondary"
          )}
        >
          {String(stage.index).padStart(2, "0")}
        </span>
        <span
          className={cn(
            "text-[13px]",
            active && "font-semibold",
            dim ? "text-text-muted" : "text-text"
          )}
        >
          {stage.icon} {stage.name}
        </span>
        <span className="flex-1" />
        <StatusDot status={stage.status} />
      </div>
      <Progress
        value={stage.progress}
        indicatorClassName={active ? "bg-primary" : "bg-success"}
      />
    </>
  );

  if (dim) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="flex w-full cursor-not-allowed flex-col gap-1.5 rounded-md p-2 text-left"
            aria-disabled
          >
            {body}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">本期未实现</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={`/p/${pid}/${stage.key}/main`}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-md p-2 text-left transition-colors",
        active && "bg-primary-subtle",
        !active && "hover:bg-bg-subtle"
      )}
    >
      {body}
    </Link>
  );
}

function CollapsedItem({ stage, pid, active }: { stage: Stage; pid: string; active: boolean }) {
  const dim = !stage.available;
  const cls = cn(
    "relative flex h-11 w-11 flex-col items-center justify-center rounded-[10px] transition-colors",
    active ? "bg-primary-subtle" : !dim && "hover:bg-bg-subtle",
    dim && "cursor-not-allowed"
  );
  const body = (
    <>
      <span
        className={cn(
          "text-[17px]",
          dim ? "opacity-40" : active ? "text-primary" : "text-text-secondary"
        )}
      >
        {stage.icon}
      </span>
      <span
        className={cn(
          "absolute right-1 top-1 h-2.5 w-2.5 rounded-full ring-[1.5px] ring-bg",
          STATUS_COLOR[stage.status].replace("text-", "bg-")
        )}
      />
    </>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {dim ? (
          <div className={cls} aria-disabled>
            {body}
          </div>
        ) : (
          <Link href={`/p/${pid}/${stage.key}/main`} className={cls}>
            {body}
          </Link>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">
        {stage.name} · {STATUS_GLYPH[stage.status]}
        {dim && " · 本期未实现"}
      </TooltipContent>
    </Tooltip>
  );
}

export function L2Stages() {
  const { pid } = useParams<{ pid: string }>();
  const pathname = usePathname();
  const stages = useEnrichedStages();
  const collapsed = useSettingStore((s) => s.l2Collapsed);
  const toggleL2 = useSettingStore((s) => s.toggleL2);

  // 工具区（矩阵 / Task / 审计）保留真实路由
  const tools = [
    { href: `/p/${pid}/matrix`, label: "追溯矩阵", icon: Network },
    { href: `/p/${pid}/tasks`,  label: "Task 列表", icon: ListChecks },
    { href: `/p/${pid}/audit`,  label: "委派审计", icon: ScrollText },
  ];

  const isActive = (key: string) => pathname.startsWith(`/p/${pid}/${key}`);

  if (collapsed) {
    return (
      <nav className="flex w-[72px] flex-col items-center gap-1 border-r border-border bg-bg px-2 py-3">
        <button
          onClick={toggleL2}
          className="mb-1 flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-bg-subtle"
          aria-label="展开阶段导航"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <div className="mb-1 h-px w-8 bg-border" />
        <div className="sf-scroll flex flex-col gap-1 overflow-y-auto">
          {stages.map((s) => (
            <CollapsedItem key={s.key} stage={s} pid={pid} active={isActive(s.key)} />
          ))}
        </div>
        <div className="mt-2 flex flex-col gap-1">
          {tools.map((t) => {
            const Icon = t.icon;
            const active = pathname === t.href;
            return (
              <Tooltip key={t.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={t.href}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-bg-subtle",
                      active && "bg-primary-subtle text-primary"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{t.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav className="flex w-[248px] flex-col gap-0.5 border-r border-border bg-bg px-2.5 py-3">
      <div className="flex items-center justify-between px-1.5 pb-2.5 pt-1">
        <span className="text-xs font-semibold text-text-muted">阶段导航 · 13</span>
        <button
          onClick={toggleL2}
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-bg-subtle"
          aria-label="折叠阶段导航"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="sf-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {stages.map((s) => (
          <ExpandedRow key={s.key} stage={s} pid={pid} active={isActive(s.key)} />
        ))}
      </div>

      {/* 工具区 */}
      <div className="mt-2 border-t border-border pt-2">
        {tools.map((t) => {
          const Icon = t.icon;
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-text-secondary hover:bg-bg-subtle",
                active && "bg-primary-subtle font-medium text-primary"
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-2 rounded-md bg-bg-subtle p-2 text-[11px] text-text-muted">
        ○ 阶段本期未实现 · 灰显占位
      </div>
    </nav>
  );
}

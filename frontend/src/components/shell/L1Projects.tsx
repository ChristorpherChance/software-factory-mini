"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Library, Plus, Link2, Settings, Upload, FileText } from "lucide-react";
import { api } from "@/lib/api";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 浅色 rail 通用按钮（图标 + tooltip）。 */
function RailButton({
  icon: Icon,
  label,
  href,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  active?: boolean;
}) {
  const cls = cn(
    "flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors",
    active
      ? "bg-primary-subtle text-primary"
      : "text-text-secondary hover:bg-bg-subtle"
  );
  const body = <Icon className="h-[18px] w-[18px]" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} className={cls} aria-label={label}>
            {body}
          </Link>
        ) : (
          <button className={cls} aria-label={label}>
            {body}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** 当前项目的方块徽标（首字 + ring）。 */
function CurrentProjectBadge({ name }: { name: string }) {
  const initial = (name ?? "项").slice(0, 1);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-[15px] font-bold text-white ring-2 ring-primary-hover">
          {initial}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{name} · 当前项目</TooltipContent>
    </Tooltip>
  );
}

// L1 项目栏：照搬原型 ProjectRail 浅色 rail 视觉；顶部产品线/新建，中部当前项目徽标，
// 底部工具区（矩阵 / 设置 / 导出 / 文档）。pid/name 接真实 api.projects()(A 档)
export function L1Projects() {
  const { pid } = useParams<{ pid: string }>();

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects,
  });

  const current = projects?.find((p) => p.id === pid);

  return (
    <aside className="flex w-[60px] flex-col items-center gap-2 border-r border-border bg-bg-subtle py-2.5">
      {/* 产品线（C 档：暂仅展示） */}
      <RailButton icon={Library} label={`产品线 · ${projects?.length ?? 0} 项目`} href="/" />

      <div className="my-1 h-px w-7 bg-border" />

      {current && <CurrentProjectBadge name={current.name} />}

      {/* 新建项目 → 跳回首页 dialog */}
      <RailButton icon={Plus} label="新建项目" href="/" />

      <div className="flex-1" />

      {/* 底部工具区：保留 Next.js 真实路由 */}
      <RailButton icon={Link2}    label="需求矩阵中心" href={`/p/${pid}/matrix`} />
      <RailButton icon={Settings} label="项目设置"     href={`/p/${pid}/settings`} />
      {/* C 档：导出 / 文档 暂占位，跳 audit 作占位入口 */}
      <RailButton icon={Upload}   label="导出（占位）" href={`/p/${pid}/audit`} />
      <RailButton icon={FileText} label="文档（占位）" href={`/p/${pid}/tasks`} />
    </aside>
  );
}

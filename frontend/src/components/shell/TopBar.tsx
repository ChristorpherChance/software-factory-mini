"use client";

import { useParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Upload,
  CheckCircle2,
  Lock,
  Bell,
  Command,
  ChevronRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { useTraceStore } from "@/stores/trace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { findStage } from "@/lib/stages";

type Tone = "neutral" | "primary" | "success" | "warning" | "error";

function StatusBadge({
  tone,
  icon,
  label,
  tip,
}: {
  tone: Tone;
  icon: string;
  label: string;
  tip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge tone={tone}>
            <span>{icon}</span>
            {label}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

/** 健康分阈值色（绿/黄/红）。 */
function healthTone(s: number): Tone {
  return s >= 0.85 ? "success" : s >= 0.7 ? "warning" : "error";
}

export function TopBar() {
  const { pid } = useParams<{ pid: string }>();
  const pathname = usePathname();
  const { healthScore, coverage } = useTraceStore();
  const { data: project } = useQuery({
    queryKey: ["project", pid],
    queryFn: () => api.project(pid),
    enabled: !!pid,
  });

  // 从 pathname 解析当前阶段 key（/p/{pid}/{stage}/{section}）
  const parts = pathname.split("/").filter(Boolean);
  const stageKey = parts[2];
  const stage = stageKey ? findStage(stageKey) : null;
  const stageLabel = stage?.name ?? "—";
  const stageIcon = stage?.icon ?? "📁";
  const sectionLabel = parts[3] ?? "main";

  // 面包屑：项目 / 阶段 / 小节（C 档：4 级面包屑后续按工件名补）
  const crumbs = [
    project?.name ?? "项目",
    stageLabel,
    sectionLabel,
  ];

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-bg-elevated px-4">
      {/* left · breadcrumb（阶段 pill + 项目/阶段/小节链） */}
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="rounded-full bg-primary-subtle px-2.5 py-1 text-[13px] font-semibold text-primary">
          {stageIcon} {stageLabel}
        </span>
        <nav className="flex items-center gap-1 truncate text-[13px] text-text-secondary">
          {crumbs.map((c, i) => (
            <span key={`${c}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-text-muted" />}
              <span className={i === 0 ? "font-medium text-text" : ""}>{c}</span>
            </span>
          ))}
        </nav>
      </div>

      <div className="flex-1" />

      {/* center · six status badges
          - 🔗 健康分接 useTraceStore (A 档)
          - 其余 5 个 C 档静态占位（沙箱/项目状态机/审查/安全/成本） */}
      <div className="flex items-center gap-2">
        <StatusBadge
          tone="neutral"
          icon="●"
          label="沙箱运行"
          tip="沙箱 ● 运行中 · CPU 24% · 内存 1.2G（TODO 真实数据源）"
        />
        <StatusBadge
          tone="neutral"
          icon="◆"
          label="running"
          tip="项目状态机：running（TODO 接 project.state）"
        />
        <StatusBadge
          tone="neutral"
          icon="🧐"
          label="审查 3"
          tip="审查 · 增量 3 项 · P0×0 P1×1 P2×2（TODO 真实数据源）"
        />
        <StatusBadge
          tone="warning"
          icon="🛡"
          label="安全 1"
          tip="安全合规 · SAST ✓ · SBOM ✓ · DPIA ◐ · critical×1（TODO 真实数据源）"
        />
        <StatusBadge
          tone={healthTone(healthScore)}
          icon="🔗"
          label={healthScore > 0 ? healthScore.toFixed(2) : "—"}
          tip={`需求追溯 healthScore ${healthScore.toFixed(2)} · L0a ${(coverage.L0a * 100).toFixed(0)}% · L0b ${(coverage.L0b * 100).toFixed(0)}% · L0c ${(coverage.L0c * 100).toFixed(0)}%`}
        />
        <StatusBadge
          tone="neutral"
          icon="💰"
          label="¥— · 预算—"
          tip="项目本月成本 / 预算占用（TODO 真实数据源）"
        />
      </div>

      <div className="flex-1" />

      {/* right · global actions */}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm">
          <CheckCircle2 className="h-4 w-4" /> 完成本阶段
        </Button>
        <Button variant="secondary" size="icon" aria-label="上传">
          <Upload className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" aria-label="锁定版本">
          <Lock className="h-4 w-4" />
        </Button>
        {/* Bell · 通知中心触发器（批 5.1 接 NotificationCenter，本批仅占位 + 静态红点） */}
        <Button
          variant="secondary"
          size="icon"
          aria-label="通知中心"
          className="relative"
        >
          <Bell className="h-4 w-4" />
          {/* TODO 批 5：替换为 useNotificationStore.unreadCount */}
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-error ring-2 ring-bg-elevated" />
        </Button>
        <button
          className="flex items-center gap-1 rounded-md border border-border bg-bg-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-border/40"
          title="命令面板（TODO ⌘K）"
        >
          <Command className="h-3 w-3" />K
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-white">
          {(project?.name ?? "陈").slice(0, 1)}
        </div>
      </div>
    </header>
  );
}

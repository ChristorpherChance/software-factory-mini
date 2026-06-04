"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Wand2, Check, RotateCcw, FileCode, History, Plus } from "lucide-react";
import { api, type CapabilityDto } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 能力库（Phase 3.5 能力进化双环）：
// - 列表：Skill/Prompt/AGENTS.md 能力 + 当前版本
// - 版本历史 + 内容预览
// - 提案（手动也可）→ 审批 → 应用（写盘+生效）→ 回滚
// 后端：/api/v1/internal/capability/*

const KIND_LABEL: Record<string, string> = {
  skill: "技能 Skill",
  prompt: "提示 Prompt",
  agent_md: "约定 AGENTS",
};

export default function CapabilitiesPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [showPropose, setShowPropose] = useState(false);

  const { data: caps, isLoading } = useQuery({
    queryKey: ["capabilities"],
    queryFn: () => api.capabilities(),
  });

  const list = (caps ?? []) as CapabilityDto[];
  const activeCap = list.find((c) => c.id === active) ?? list[0] ?? null;

  const { data: versions } = useQuery({
    queryKey: ["capability-versions", activeCap?.id],
    queryFn: () => api.capabilityVersions(activeCap!.id),
    enabled: !!activeCap,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["capabilities"] });
    qc.invalidateQueries({ queryKey: ["capability-versions"] });
  };

  const apply = useMutation({
    mutationFn: (versionId: string) => api.applyCapability(versionId),
    onSuccess: (r) => {
      alert(`已应用「${r.name}」并生效（评测分 ${r.score}）`);
      refresh();
    },
    onError: (e: any) => alert(`应用失败：${e?.body?.error?.message ?? e?.message ?? "未知"}（需先审批且评测≥0.85）`),
  });
  const rollback = useMutation({
    mutationFn: (versionId: string) => api.rollbackCapability(versionId),
    onSuccess: (r) => {
      alert(`已回滚「${r.name}」至 v${r.version}`);
      refresh();
    },
    onError: (e: any) => alert(`回滚失败：${e?.body?.error?.message ?? "无上一版本"}`),
  });

  return (
    <div className="flex h-full">
      {/* 左：能力列表 */}
      <aside className="w-64 shrink-0 space-y-2 overflow-y-auto border-r border-border bg-bg-subtle p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">能力库</h2>
          <Button variant="ghost" size="icon" onClick={() => setShowPropose(true)} title="手动提案">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {isLoading ? (
          <p className="text-xs text-text-muted">加载…</p>
        ) : list.length === 0 ? (
          <p className="text-xs text-text-muted">暂无能力。Agent 可经 skill_propose 提案，或点 + 手动提案。</p>
        ) : (
          list.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border border-border bg-bg p-2.5 text-left transition-colors hover:border-primary",
                activeCap?.id === c.id && "border-primary ring-1 ring-primary/30"
              )}
            >
              <FileCode className="h-3.5 w-3.5 text-text-secondary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text">{c.name}</div>
                <div className="text-[11px] text-text-muted">
                  {KIND_LABEL[c.kind] ?? c.kind} · v{c.currentVersion}
                  {c.status === "finalized" && " · 已生效"}
                </div>
              </div>
            </button>
          ))
        )}
      </aside>

      {/* 右：详情 + 版本历史 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
        {!activeCap ? (
          <p className="text-sm text-text-muted">从左侧选择一个能力查看版本与内容。</p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🧩</span>
                <h1 className="text-xl font-semibold text-text">{activeCap.name}</h1>
                <span className="rounded-md border border-border bg-bg-subtle px-2 py-0.5 text-xs text-text-secondary">
                  {KIND_LABEL[activeCap.kind] ?? activeCap.kind} · v{activeCap.currentVersion}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {activeCap.latestVersionId && (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => apply.mutate(activeCap.latestVersionId!)}
                      disabled={apply.isPending}
                    >
                      <Check className="h-3.5 w-3.5" /> 应用最新版
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => rollback.mutate(activeCap.latestVersionId!)}
                      disabled={rollback.isPending}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> 回滚
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* 当前内容 */}
            <section className="mb-4">
              <h3 className="mb-1.5 text-sm font-semibold text-text">当前内容</h3>
              <pre className="sf-scroll max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-bg-subtle p-3 text-[13px] text-text-secondary">
                {activeCap.content || "（空）"}
              </pre>
            </section>

            {/* 版本历史 */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-text">
                <History className="h-3.5 w-3.5" /> 版本历史
              </h3>
              <ul className="space-y-1.5">
                {(versions ?? []).map((v) => (
                  <li
                    key={v.versionId}
                    className="flex items-center justify-between rounded-md border border-border bg-bg p-2 text-[13px]"
                  >
                    <span className="font-mono text-text">v{v.version}</span>
                    <span className="min-w-0 flex-1 truncate px-2 text-text-secondary">
                      {v.note || "（无说明）"} · {v.author}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => apply.mutate(v.versionId)}
                      disabled={apply.isPending}
                      title="审批通过后可应用此版本"
                    >
                      <Wand2 className="h-3 w-3" /> 应用
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>

      {showPropose && <ProposeDialog onClose={() => { setShowPropose(false); refresh(); }} />}
    </div>
  );
}

// 手动提案对话框（演示双环；实际多由 Agent skill_propose 触发）
function ProposeDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"skill" | "prompt" | "agent_md">("skill");
  const [draft, setDraft] = useState("");
  const [rationale, setRationale] = useState("");

  const propose = useMutation({
    mutationFn: () => api.proposeCapability({ name, kind, draft, rationale }),
    onSuccess: (r) => {
      // 提案后立即审批（演示），实际可在待定区审批
      api.approveCapability(r.pending_change_id).finally(() => {
        qc.invalidateQueries({ queryKey: ["capabilities"] });
        onClose();
      });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-[480px] space-y-3 rounded-lg border border-border bg-bg-elevated p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-text">提案新能力</h3>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="能力名（如 rtm-maintain）"
          className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-primary"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as any)}
          className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
        >
          <option value="skill">技能 Skill</option>
          <option value="prompt">提示 Prompt</option>
          <option value="agent_md">约定 AGENTS</option>
        </select>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="能力草案内容（Markdown）"
          className="sf-scroll h-32 w-full resize-none rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-primary"
        />
        <input
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="提案理由"
          className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-primary"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => propose.mutate()}
            disabled={!name.trim() || !draft.trim() || propose.isPending}
          >
            提案并审批
          </Button>
        </div>
      </div>
    </div>
  );
}

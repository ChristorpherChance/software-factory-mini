"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pencil,
  History,
  GitCompare,
  Lock,
  Upload,
  MoreHorizontal,
  Check,
  X,
  RotateCw,
  FileText,
  Link2,
  Wand2,
  ChevronDown,
  UploadCloud,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { api, type ArtifactDto, type PendingChangeDto, type MaterialDto } from "@/lib/api";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { DiffView } from "@/components/artifact/DiffView";
import { DiffBlockView } from "@/components/artifact/DiffBlockView";
import { SelfCheckPanel } from "@/components/requirement/SelfCheckPanel";
import { useSessionStore } from "@/stores/session";
import { useHitlStore } from "@/stores/hitl";
import { cn } from "@/lib/utils";

// 需求视图（20260603 改版）：
// - 去掉 ORD 标签，默认 CRD；保留 CRD / PRD / RTM Link
// - CRD/PRD 标题栏下方新增「参考资料栏」：默认加载已定稿资料 + 下拉勾选 + 上传 .md
// - 生成按钮文本随有无版本切换：生成 / 重新生成
// - 对话修改只改本地草稿；点「版本提交」才落库（submitVersion）

const SECTIONS = [
  { key: "crd", label: "CRD 客户需求", toType: "crd" },
  { key: "prd", label: "PRD 产品需求", toType: "prd" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

// TODO 真实数据源：解析 markdown heading 生成 TOC
const TOC_STATIC = [
  { label: "1. 背景与目标", level: 1 },
  { label: "2. 用户故事",   level: 1, active: true },
  { label: "2.1 下单流程",  level: 2 },
  { label: "2.2 支付与退款", level: 2 },
  { label: "3. 功能性需求", level: 1 },
  { label: "4. 非功能性需求", level: 1 },
  { label: "5. 验收标准",   level: 1 },
];

type ViewMode = "render" | "source" | "diff";

export function RequirementView() {
  const { pid } = useParams<{ pid: string }>();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const sid = useSessionStore((s) => s.sid);
  const push = useSessionStore((s) => s.push);
  const mode = useHitlStore((s) => s.mode);

  const [section, setSection] = useState<SectionKey>("crd");
  const [view, setView] = useState<ViewMode>("render");

  // 参考资料栏状态（20260603）
  const [refIds, setRefIds] = useState<string[]>([]);
  const [refDropdown, setRefDropdown] = useState(false);
  const [refInitialized, setRefInitialized] = useState(false);
  const mdInput = useRef<HTMLInputElement>(null);

  // 支持 ?view= query 联动（PendingActions 的 D 跳 diff 用）
  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "render" || v === "source" || v === "diff") setView(v);
  }, [searchParams]);

  // 当前 section 的最新工件
  const { data: artifact, isLoading } = useQuery({
    queryKey: ["artifacts", pid, section],
    queryFn: async () => {
      const list = await api.artifacts(pid, section);
      return (list ?? [])[0] as ArtifactDto | undefined;
    },
    enabled: !!pid,
  });

  // 已定稿资料（参考资料候选）
  const { data: materials } = useQuery({
    queryKey: ["materials", pid],
    queryFn: () => api.materials(pid),
    enabled: !!pid,
  });
  const finalizedMats = ((materials ?? []) as MaterialDto[]).filter(
    (m) => m.status === "finalized"
  );

  // 默认加载：首次拿到已定稿资料时，自动全选为参考资料
  useEffect(() => {
    if (!refInitialized && finalizedMats.length > 0) {
      setRefIds(finalizedMats.map((m) => m.id));
      setRefInitialized(true);
    }
  }, [finalizedMats, refInitialized]);

  const saveRefs = useMutation({
    mutationFn: (ids: string[]) =>
      artifact ? api.setReferences(pid, artifact.id, ids) : Promise.resolve(null as any),
  });
  const toggleRef = (id: string) => {
    setRefIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      saveRefs.mutate(next);
      return next;
    });
  };

  // 项目 pending（用于顶部汇总条 + 行内 Diff 块）
  const { data: pendings } = useQuery({
    queryKey: ["pending-changes", pid, "pending"],
    queryFn: () => api.pendingChanges(pid, "pending"),
    enabled: !!pid,
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["pending-changes"] });
    qc.invalidateQueries({ queryKey: ["artifacts"] });
    qc.invalidateQueries({ queryKey: ["artifact"] });
    qc.invalidateQueries({ queryKey: ["rtm"] });
  };

  const approveAll = useMutation({
    mutationFn: async (items: PendingChangeDto[]) => {
      for (const c of items) await api.approve(c.id);
    },
    onSuccess: refreshAll,
  });
  const rejectAll = useMutation({
    mutationFn: async (items: PendingChangeDto[]) => {
      for (const c of items) await api.reject(c.id, "user bulk reject");
    },
    onSuccess: refreshAll,
  });

  // 触发"生成本 section 工件"
  const generate = async () => {
    if (!sid) return;
    const verb = artifact ? "重新生成" : "生成";
    const content = `${verb} ${section.toUpperCase()}`;
    push({ id: `local-${Date.now()}`, role: "user", content });
    try {
      await api.send(sid, content, mode);
    } catch {
      /* 后端不可达时静默；SSE 会推送结果 */
    }
  };

  // 版本提交：把当前草稿 content 落库为新版本（与对话修改分离）
  const submitVersion = useMutation({
    mutationFn: () =>
      artifact
        ? api.submitVersion(pid, artifact.id, artifact.content ?? "", "版本提交")
        : Promise.resolve(null as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artifacts", pid, section] });
    },
  });

  // 上传 .md 作为参考资料（非 md 提示走资料阶段）
  const uploadMd = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      return api.parseMaterial(pid, {
        source: text,
        isText: true,
        title: file.name,
      });
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["materials", pid] });
      if (m?.id) setRefIds((cur) => [...cur, m.id]);
    },
  });
  const onPickMd = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md")) {
      alert("仅支持 .md 文件；其他格式请到「资料」阶段上传并解析。");
      return;
    }
    uploadMd.mutate(file);
  };

  // 切换 section 时，复位 view 模式（避免源码态残留到渲染态）
  useEffect(() => setView("render"), [section]);

  const ver = artifact?.currentVersion ?? artifact?.version ?? 1;
  const canDiff = ver > 1;
  const remaining = (pendings ?? []).length;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-bg">
      {/* 子标签栏：CRD/PRD + RTM Link */}
      <div className="flex items-end gap-1 border-b border-border px-4 pt-1.5">
        {SECTIONS.map((s) => {
          const isActive = section === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={cn(
                "relative -mb-px px-3 pb-2 pt-2 text-[13px] border-b-2 transition-colors",
                isActive
                  ? "border-primary font-semibold text-primary"
                  : "border-transparent text-text-secondary"
              )}
            >
              {s.label}
            </button>
          );
        })}
        <Link
          href={`/p/${pid}/matrix`}
          className="relative -mb-px border-b-2 border-transparent px-3 pb-2 pt-2 text-[13px] text-text-secondary transition-colors hover:text-primary"
          title="跳转至追溯矩阵"
        >
          🔗 RTM 追溯矩阵
        </Link>
      </div>

      {/* 工件标题栏 */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-lg">📝</span>
          <h1 className="truncate text-xl font-semibold text-text">
            {artifact?.title ?? `${section.toUpperCase()} · 暂无工件`}
          </h1>
          {artifact && (
            <>
              <span className="rounded-md border border-border bg-bg-subtle px-2 py-0.5 text-xs font-semibold text-text-secondary">
                v{ver}
              </span>
              <span className="flex items-center gap-1.5 rounded-md bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">
                ◐ {artifact.status ?? "草拟中"}
              </span>
            </>
          )}
          <span className="text-xs text-info">· 责任 @需求Agent</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* 生成 / 重新生成（接 api.send → 编排 → SSE 推 artifact.created） */}
          <Button variant="secondary" size="sm" onClick={generate} disabled={!sid}>
            <Wand2 className="h-3.5 w-3.5" /> {artifact ? "重新生成" : "生成"}{" "}
            {section.toUpperCase()}
          </Button>
          {/* 版本提交（落库新版本，与对话修改分离） */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => submitVersion.mutate()}
            disabled={!artifact || submitVersion.isPending}
            title="将当前内容提交为新版本"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            {submitVersion.isPending ? "提交中…" : "版本提交"}
          </Button>
          {[Pencil, History, GitCompare, Upload].map((Icon, i) => (
            <button
              key={i}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-subtle text-text-secondary hover:bg-border/40"
              title="本期占位（TODO）"
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
          <Button variant="primary" size="sm" disabled={!artifact}>
            <Lock className="h-3.5 w-3.5" /> 定稿
          </Button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-subtle text-text-secondary hover:bg-border/40"
            title="更多"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 参考资料栏（20260603）：默认加载已定稿资料，可下拉勾选 + 上传 .md */}
      <div className="flex items-center gap-2 border-y border-border bg-primary-subtle/30 px-5 py-2">
        <span className="shrink-0 text-xs font-semibold text-text-secondary">📎 参考资料</span>

        {/* 已选标签 */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {refIds.length === 0 ? (
            <span className="text-xs text-text-muted">未选择（默认使用全部已定稿资料）</span>
          ) : (
            refIds.map((id) => {
              const m = finalizedMats.find((x) => x.id === id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full bg-bg border border-border px-2 py-0.5 text-[11px] text-text"
                >
                  <FileText className="h-3 w-3 text-text-secondary" />
                  {m?.title ?? id.slice(0, 6)}
                  <button onClick={() => toggleRef(id)} className="text-text-muted hover:text-error">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })
          )}
        </div>

        {/* 下拉勾选 */}
        <div className="relative shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRefDropdown((v) => !v)}
          >
            勾选资料 <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          {refDropdown && (
            <div className="absolute right-0 z-20 mt-1 max-h-64 w-60 overflow-y-auto rounded-md border border-border bg-bg-elevated p-1 shadow-lg">
              {finalizedMats.length === 0 ? (
                <p className="p-2 text-[11px] text-text-muted">
                  暂无已定稿资料，请先在资料阶段定稿。
                </p>
              ) : (
                finalizedMats.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => toggleRef(m.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-text hover:bg-bg-subtle"
                  >
                    {refIds.includes(m.id) ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <span className="h-3.5 w-3.5" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* 上传 .md */}
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => mdInput.current?.click()}
          disabled={uploadMd.isPending}
        >
          <Upload className="h-3.5 w-3.5" /> 上传 .md
        </Button>
        <input
          ref={mdInput}
          type="file"
          accept=".md"
          hidden
          onChange={(e) => {
            onPickMd(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {/* 横切活动条（C 档：审查 / 安全 静态占位，TODO 真实数据源） */}
      <div className="flex items-center gap-4 border-y border-border bg-bg-subtle px-5 py-2 text-xs text-text-secondary">
        <span>🧐 审查 · 增量 PR#42 ◐ 进行中</span>
        <span className="h-3.5 w-px bg-border" />
        <span>🛡 安全 · SAST ✓ · SBOM ✓ · DPIA ◐</span>
        <span className="flex-1" />
        <span className="text-text-muted">TODO 真实数据源 · 失败项可跳转</span>
      </div>

      {/* Segmented + pending 汇总条 */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <Segmented
          value={view}
          onChange={(v) => setView(v as ViewMode)}
          options={[
            { value: "render", label: "渲染" },
            { value: "source", label: "Markdown 源码" },
            { value: "diff",   label: "并排 Diff" },
          ]}
        />
        {remaining > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-pending bg-warning-subtle py-1.5 pl-3 pr-1.5">
            <span className="text-xs font-semibold text-warning">
              🟡 {remaining} 处待确认改动
            </span>
            <Button
              variant="success"
              size="sm"
              onClick={() => approveAll.mutate(pendings ?? [])}
              disabled={approveAll.isPending}
            >
              <Check className="h-3 w-3" /> 全部确认
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => rejectAll.mutate(pendings ?? [])}
              disabled={rejectAll.isPending}
            >
              <X className="h-3 w-3" /> 全部拒绝
            </Button>
            <Button variant="outline" size="icon" title="重生（TODO）">
              <RotateCw className="h-3 w-3" />
            </Button>
            <Button variant="outline" size="icon" title="跳转明细（TODO）">
              <FileText className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* 内容区：TOC 两栏 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* TOC（C 档：静态。TODO 解析 markdown heading 生成） */}
        <aside className="sf-scroll w-52 shrink-0 space-y-0.5 overflow-y-auto border-r border-border bg-bg-subtle px-3 py-4">
          <div className="pb-2 text-[11px] font-semibold text-text-muted">
            目录 · TOC（占位）
          </div>
          {TOC_STATIC.map((t) => (
            <button
              key={t.label}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left",
                t.active && "bg-primary-subtle"
              )}
              style={{ paddingLeft: 8 + (t.level - 1) * 12 }}
            >
              <span
                className={cn(
                  "text-xs",
                  t.active
                    ? "font-semibold text-primary"
                    : t.level > 1
                      ? "text-text-muted"
                      : "text-text-secondary"
                )}
              >
                {t.label}
              </span>
              {t.active && <Link2 className="h-3 w-3 text-primary" />}
            </button>
          ))}
        </aside>

        {/* 文档主体：根据 view 切换 渲染/源码/Diff */}
        <div className="sf-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-10 py-6">
          {isLoading ? (
            <p className="text-sm text-text-muted">加载工件…</p>
          ) : !artifact ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-muted">
              本 section 暂无工件，点击右上「生成 {section.toUpperCase()}」让编排 Agent 产出。
            </div>
          ) : view === "source" ? (
            <pre className="sf-scroll whitespace-pre-wrap rounded-md border border-border bg-bg-subtle p-4 text-[13px] leading-relaxed text-text">
              {artifact.content ?? ""}
            </pre>
          ) : view === "diff" ? (
            // 优先：当前工件所属 pending 的 diffBlocks（按块 ✓/✗ 三态视图）；
            // 否则：回落到旧 unified DiffView（需要 v>1 才可比对）。
            (() => {
              const ownPending = (pendings ?? []).find(
                (p) => p.targetId === artifact.id && p.diffBlocks && p.diffBlocks.length > 0
              );
              if (ownPending) {
                return (
                  <div className="space-y-2.5">
                    <p className="text-xs text-text-muted">
                      {ownPending.diffBlocks!.length} 处变更 ·
                      逐块 ✓/✗ 即可按块定夺；全块定后聚合为 pending 整体状态。
                    </p>
                    {ownPending.diffBlocks!.map((b) => (
                      <DiffBlockView key={b.id} cid={ownPending.id} block={b} />
                    ))}
                  </div>
                );
              }
              if (canDiff) return <DiffView aid={artifact.id} from={ver - 1} to={ver} />;
              return (
                <p className="text-sm text-text-muted">
                  当前 v{ver} 是首版，且无待定 pending diff 块，暂无可对比内容。
                </p>
              );
            })()
          ) : (
            <article className="prose prose-sm max-w-none text-text">
              <ReactMarkdown>{artifact.content ?? ""}</ReactMarkdown>
            </article>
          )}
        </div>
      </div>

      {/* 底部：需求自检 + 定稿（保留现有 SelfCheckPanel） */}
      <div className="shrink-0 border-t border-border p-4">
        {sid ? (
          <SelfCheckPanel pid={pid} sid={sid} />
        ) : (
          <p className="text-sm text-text-muted">会话建立后可运行自检。</p>
        )}
      </div>
    </div>
  );
}

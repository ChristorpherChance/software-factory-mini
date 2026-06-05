"use client";

import { useEffect, useState, useRef, useMemo, type ReactNode } from "react";
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
  Wand2,
  ChevronDown,
  UploadCloud,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type ArtifactDto, type PendingChangeDto, type MaterialDto } from "@/lib/api";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { DiffView } from "@/components/artifact/DiffView";
import { DiffBlockView } from "@/components/artifact/DiffBlockView";
import { InlineHighlightView } from "@/components/artifact/InlineHighlightView";
import { SelfCheckPanel } from "@/components/requirement/SelfCheckPanel";
import { useSessionStore } from "@/stores/session";
import { useHitlStore } from "@/stores/hitl";
import { useEditTargetStore } from "@/stores/editTarget";
import { cn } from "@/lib/utils";

// 需求视图（20260603 改版）：
// - 去掉 ORD 标签，默认 CRD；保留 CRD / PRD / RTM Link
// - CRD/PRD 标题栏下方新增「参考资料栏」：默认加载已定稿资料 + 下拉勾选 + 上传 .md
// - 生成按钮文本随有无版本切换：生成 / 重新生成
// - 对话修改只改本地草稿；点「版本提交」才落库（submitVersion）

const SECTIONS = [
  { key: "crd", label: "客户需求 CRD", toType: "crd" },
  { key: "prd", label: "产品需求 PRD", toType: "prd" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

interface TocItem {
  label: string;
  level: number;
  id: string;
}

// 从 Markdown 解析真实目录（跳过围栏代码块；id 按 heading 出现顺序，与渲染端注入保持一致）
function parseToc(md: string): TocItem[] {
  const out: TocItem[] = [];
  let inFence = false;
  let ord = 0;
  for (const line of (md ?? "").split("\n")) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) out.push({ level: m[1].length, label: m[2].trim(), id: `h-${ord++}` });
  }
  return out;
}

// ReactMarkdown heading 组件：按出现顺序注入 id（与 parseToc 对齐），供 TOC 点击跳转。
// 每次渲染新建（计数器从 0 重置），避免跨渲染累加。
function makeMdComponents() {
  let ord = 0;
  const mk = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
    function Heading(props: { children?: ReactNode }) {
      const id = `h-${ord++}`;
      return <Tag id={id}>{props.children}</Tag>;
    };
  return { h1: mk("h1"), h2: mk("h2"), h3: mk("h3"), h4: mk("h4"), h5: mk("h5"), h6: mk("h6") };
}

type ViewMode = "render" | "source" | "diff";

export function RequirementView() {
  const { pid } = useParams<{ pid: string }>();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const sid = useSessionStore((s) => s.sid);
  const push = useSessionStore((s) => s.push);
  const mode = useHitlStore((s) => s.mode);
  const setEditTarget = useEditTargetStore((s) => s.setTarget);

  const [section, setSection] = useState<SectionKey>("crd");
  const [view, setView] = useState<ViewMode>("render");

  // 版本下拉 + 本地草稿（编辑只改草稿，不落库；落库走「版本提交」）
  const [selVer, setSelVer] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [dirty, setDirty] = useState(false);

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
      // React Query 不允许 queryFn 返回 undefined（会报错并不更新）：无工件时返回 null
      return ((list ?? [])[0] as ArtifactDto | undefined) ?? null;
    },
    enabled: !!pid,
  });

  // 当前最高版本号
  const ver = artifact?.currentVersion ?? artifact?.version ?? 1;

  // 版本列表（后端正序；下拉里倒序展示，最新在上）
  const { data: versions } = useQuery({
    queryKey: ["artifact-versions", artifact?.id],
    queryFn: () => api.artifactVersions(artifact!.id),
    enabled: !!artifact,
  });

  // 切换 section/工件时复位选中版本与草稿
  useEffect(() => {
    setSelVer(null);
    setDirty(false);
  }, [artifact?.id]);
  // 选中版本默认 = 最高版
  useEffect(() => {
    if (artifact && selVer == null) setSelVer(ver);
  }, [artifact, ver, selVer]);

  // 选中历史版本时单独拉取其内容（最高版直接用 list 已带的最新 content）
  const isLatestSel = selVer == null || selVer === ver;
  const { data: selVersionData, isFetching: selFetching } = useQuery({
    queryKey: ["artifact-version", artifact?.id, selVer],
    queryFn: () => api.artifactVersion(artifact!.id, selVer!),
    enabled: !!artifact && selVer != null && !isLatestSel,
  });
  // 基准内容（随选中版本变化）；显示内容：改过则用草稿，否则用基准（无闪烁）
  const baseContent = isLatestSel ? artifact?.content ?? "" : selVersionData?.content ?? "";
  const shown = dirty ? draft : baseContent;

  // 解析真实 TOC（基于当前显示内容）+ heading id 注入组件
  const toc = useMemo(() => parseToc(shown), [shown]);
  const mdComponents = makeMdComponents();

  // 已定稿资料（参考资料候选）：资料阶段（内容解析定稿）+ 需求页直接上传的专用参考（crd_ref）
  const { data: materials } = useQuery({
    queryKey: ["materials", pid],
    queryFn: () => api.materials(pid),
    enabled: !!pid,
  });
  const { data: crdRefMats } = useQuery({
    queryKey: ["materials", pid, "crd_ref"],
    queryFn: () => api.materials(pid, "crd_ref"),
    enabled: !!pid,
  });
  // 参考资料候选：
  //  - 资料阶段：status=finalized 且 contentParsed（两阶段独立定稿后才可用）
  //  - 需求页直接上传（crd_ref）：上传即定稿可用
  const finalizedMats = useMemo(() => {
    const stage = ((materials ?? []) as MaterialDto[]).filter(
      (m) => m.status === "finalized" && m.contentParsed === true
    );
    const refs = (crdRefMats ?? []) as MaterialDto[];
    const seen = new Set(stage.map((m) => m.id));
    return [...stage, ...refs.filter((m) => !seen.has(m.id))];
  }, [materials, crdRefMats]);

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

  // 当前工件所属的待定变更（带切块 diff）；渲染态行内高亮 + 并排 Diff 共用
  const ownPending = useMemo(
    () =>
      (pendings ?? []).find(
        (p) => p.targetId === artifact?.id && p.diffBlocks && p.diffBlocks.length > 0
      ),
    [pendings, artifact?.id]
  );
  const hasPendingHighlight = !!ownPending?.diffBlocks?.some((b) => b.state === "pending");

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
      // 把当前勾选的参考资料一并传给编排（空则后端默认用全部已定稿资料）
      await api.send(sid, content, mode, refIds);
    } catch {
      /* 后端不可达时静默；SSE 会推送结果 */
    }
  };

  // 版本提交：把当前草稿落库为新版本（最高版+1，与对话修改分离）
  const submitVersion = useMutation({
    mutationFn: () =>
      artifact
        ? api.submitVersion(pid, artifact.id, draft, "版本提交")
        : Promise.resolve(null as any),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["artifacts", pid, section] });
      qc.invalidateQueries({ queryKey: ["artifact-versions", artifact?.id] });
      setDirty(false);
      if (res?.version) setSelVer(res.version);
    },
  });

  // 按目录大纲建 Task（每章节一条，软关联 code=<KIND>-S<n>），在右侧进度区逐步完成
  const createSectionTasks = useMutation({
    mutationFn: () =>
      api.createTasks(
        pid,
        toc.map((t, i) => ({
          code: `${section.toUpperCase()}-S${i + 1}`,
          title: t.label,
          stage: "requirement",
        }))
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", pid] }),
  });

  // 上传参考资料（任意格式）：走真实上传+解析管线（PDF/Word/图片由后端 extract 抽取），
  // asReference 直接视为内容解析定稿，立即作为参考资料。
  const uploadMd = useMutation({
    mutationFn: async (file: File) => {
      const uploaded = await api.uploadFile(pid, file);
      return api.parseMaterial(pid, {
        file_id: uploaded.id,
        asReference: true,
        scope: "crd_ref", // 需求页专用参考资料，不进资料阶段列表（问题4）
      });
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["materials", pid, "crd_ref"] });
      qc.invalidateQueries({ queryKey: ["files", pid] });
      if (m?.id) setRefIds((cur) => [...cur, m.id]);
    },
  });
  const onPickMd = (file: File | undefined) => {
    if (!file) return;
    uploadMd.mutate(file);
  };

  // 切换 section 时，复位 view 模式（避免源码态残留到渲染态）
  useEffect(() => setView("render"), [section]);

  // 把「当前主区工件」写入 editTarget store，供对话区定向编辑定位目标（问题2）
  useEffect(() => {
    setEditTarget(section, artifact?.id ?? null);
    return () => setEditTarget(null, null);
  }, [section, artifact?.id, setEditTarget]);

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
              {/* 版本下拉：选任意版本在内容区展示；选中后编辑不改动该版本，落库走「版本提交」 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-1 rounded-md border border-border bg-bg-subtle px-2 py-0.5 text-xs font-semibold text-text-secondary hover:bg-border/40"
                    title="切换版本"
                  >
                    v{selVer ?? ver}
                    {!isLatestSel && <span className="text-text-muted">（历史）</span>}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                  {(versions ?? [])
                    .slice()
                    .sort((a, b) => b.version - a.version)
                    .map((v) => (
                      <DropdownMenuItem
                        key={v.version}
                        onSelect={() => {
                          setDirty(false);
                          setSelVer(v.version);
                        }}
                        className="text-xs"
                      >
                        <span className="font-semibold">v{v.version}</span>
                        {v.version === ver && (
                          <span className="text-[10px] text-primary">最新</span>
                        )}
                        {v.note && (
                          <span className="truncate text-text-muted">· {v.note}</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
            disabled={!artifact || selVer == null || !dirty || submitVersion.isPending}
            title={
              !dirty
                ? "选择版本并修改内容后可提交为新版本"
                : "将当前内容提交为新版本（最高版+1）"
            }
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
          <Upload className="h-3.5 w-3.5" /> {uploadMd.isPending ? "上传中…" : "上传参考资料"}
        </Button>
        <input
          ref={mdInput}
          type="file"
          accept=".md,.markdown,.txt,.pdf,.docx,.png,.jpg,.jpeg"
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
          <div className="flex items-center justify-between gap-1 pb-2">
            <span className="text-[11px] font-semibold text-text-muted">目录 · TOC</span>
            {toc.length > 0 && (
              <button
                onClick={() => createSectionTasks.mutate()}
                disabled={createSectionTasks.isPending}
                title="把每个章节列成 Task，在右侧进度区逐步完成"
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-border/40 disabled:opacity-50"
              >
                {createSectionTasks.isPending ? "建任务…" : "＋建任务"}
              </button>
            )}
          </div>
          {toc.length === 0 ? (
            <p className="px-2 text-[11px] text-text-muted">暂无目录（文档无标题）</p>
          ) : (
            toc.map((t) => (
              <button
                key={t.id}
                onClick={() =>
                  document
                    .getElementById(t.id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-primary-subtle/60"
                style={{ paddingLeft: 8 + (t.level - 1) * 12 }}
                title={t.label}
              >
                <span
                  className={cn(
                    "truncate text-xs",
                    t.level > 1 ? "text-text-muted" : "text-text-secondary"
                  )}
                >
                  {t.label}
                </span>
              </button>
            ))
          )}
        </aside>

        {/* 文档主体：根据 view 切换 渲染/源码/Diff */}
        <div className="sf-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-10 py-6">
          {isLoading ? (
            <p className="text-sm text-text-muted">加载工件…</p>
          ) : !artifact ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-muted">
              本 section 暂无工件，点击右上「生成 {section.toUpperCase()}」让编排 Agent 产出。
            </div>
          ) : selFetching && !isLatestSel ? (
            <p className="text-sm text-text-muted">加载版本 v{selVer}…</p>
          ) : view === "source" ? (
            // 可编辑源码：编辑只改本地草稿，不落库；点「版本提交」才落为新版本
            <textarea
              value={shown}
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              className="sf-scroll min-h-[60vh] w-full resize-none whitespace-pre-wrap rounded-md border border-border bg-bg-subtle p-4 font-mono text-[13px] leading-relaxed text-text outline-none focus:border-primary"
            />
          ) : view === "diff" ? (
            // 优先：当前工件所属 pending 的 diffBlocks（按块 ✓/✗ 三态视图）；
            // 否则：回落到旧 unified DiffView（需要 v>1 才可比对）。
            (() => {
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
          ) : hasPendingHighlight && ownPending ? (
            // 渲染态行内高亮：新增/修改/删除就近凸显，逐块确认后消失
            <InlineHighlightView
              content={shown}
              blocks={ownPending.diffBlocks!}
              cid={ownPending.id}
              onResolve={refreshAll}
              onGoDiff={() => setView("diff")}
            />
          ) : (
            <article className="prose prose-sm max-w-none text-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{shown}</ReactMarkdown>
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

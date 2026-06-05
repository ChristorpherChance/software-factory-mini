"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pencil,
  History,
  GitCompare,
  Lock,
  Unlock,
  Download,
  Undo2,
  Redo2,
  MoreHorizontal,
  Check,
  X,
  RotateCw,
  RotateCcw,
  FileText,
  Wand2,
  ChevronDown,
  UploadCloud,
  Quote,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type ArtifactDto, type PendingChangeDto, type MaterialDto } from "@/lib/api";
import {
  downloadMarkdown,
  exportDocFromHtml,
  exportPdfFromHtml,
} from "@/lib/export";
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

type ViewMode = "render" | "source" | "diff";

export function RequirementView() {
  const { pid } = useParams<{ pid: string }>();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const sid = useSessionStore((s) => s.sid);
  const push = useSessionStore((s) => s.push);
  const mode = useHitlStore((s) => s.mode);
  const setEditTarget = useEditTargetStore((s) => s.setTarget);
  // 问题3：划选文档片段后写入 store，供对话区显示「引用 chip」并定向编辑
  const setQuote = useEditTargetStore((s) => s.setQuote);

  const [section, setSection] = useState<SectionKey>("crd");
  const [view, setView] = useState<ViewMode>("render");

  // 版本下拉 + 本地草稿（编辑只改草稿，不落库；落库走「版本提交」）
  const [selVer, setSelVer] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  // 撤销栈：source 编辑前的历史快照（pop 一个即恢复上一步）
  const [history, setHistory] = useState<string[]>([]);
  // 重做栈（问题7）：撤销时把当前值压入；重做时弹出恢复；新编辑发生时清空
  const [redo, setRedo] = useState<string[]>([]);

  // 参考资料栏状态（20260603）
  const [refIds, setRefIds] = useState<string[]>([]);
  const [refDropdown, setRefDropdown] = useState(false);
  const [refInitialized, setRefInitialized] = useState(false);

  // 渲染态 <article> 引用（导出 doc/pdf 取其 innerHTML）；文档主体滚动容器引用（TOC 精准联动）
  const articleRef = useRef<HTMLElement>(null);
  const docScrollRef = useRef<HTMLDivElement>(null);
  // 目录侧栏容器引用（问题8：activeTocId 变化时把高亮项居中到目录可视区）
  const tocAsideRef = useRef<HTMLDivElement>(null);

  // 问题8：当前高亮的目录项「序号」（点击 TOC 或滚动联动时更新；-1 表示无）。
  // 用序号而非 id：导航统一按「DOM 中第 i 个标题」定位，免疫 id 漂移与分段渲染。
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  // 问题3：划选引用浮动按钮（落点 = 选区相对文档滚动容器的坐标）
  const [quoteBtn, setQuoteBtn] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);

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

  // 切换 section/工件时复位选中版本、草稿与撤销栈
  // 注意：仅依赖 artifact?.id（切换 section/工件），不随 view 切换复位，
  //       保证 source 视图的编辑切回 render 时仍生效（问题7）。
  useEffect(() => {
    setSelVer(null);
    setDirty(false);
    setDraft("");
    setHistory([]);
    setRedo([]);
  }, [artifact?.id]);
  // 注意：不再把 selVer 钉死到当前最高版（问题1B）。
  // selVer == null 即“跟随最新”——这样定向编辑确认产生新版本后，视图会自动切到最新版显示改动；
  // 仅当用户从版本下拉显式选择历史版本时 selVer 才为具体数字。
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

  // TOC 在 ownPending 计算后定义（见下方 renderedDocContent），导航改用「DOM 第 i 个标题」
  // 索引定位，免疫 ReactMarkdown id 计数漂移与 InlineHighlightView 分段渲染（问题2）。

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

  // 问题1：CRD 工件状态（PRD 阶段判断是否已定稿 + 自动关联 CRD 定稿文档）
  const { data: crdArtifact } = useQuery({
    queryKey: ["artifacts", pid, "crd"],
    queryFn: async () => {
      const list = await api.artifacts(pid, "crd");
      return ((list ?? [])[0] as ArtifactDto | undefined) ?? null;
    },
    enabled: !!pid,
  });
  const crdFinalized = crdArtifact?.status === "finalized";

  // 切换 section 时复位参考资料初始化标志，按新 section 重新应用默认（问题1）
  useEffect(() => {
    setRefInitialized(false);
    setRefIds([]);
  }, [section]);

  // 默认加载（问题1，按 section 区分）：
  //  - crd：维持现状，首次拿到已定稿资料时自动全选为参考资料。
  //  - prd：默认不自动选资料（refIds=[]），CRD 定稿文档由后端自动关联（栏内显示信息 chip）。
  //         用户仍可手动叠加勾选资料。
  useEffect(() => {
    if (refInitialized) return;
    if (section === "crd") {
      if (finalizedMats.length > 0) {
        setRefIds(finalizedMats.map((m) => m.id));
        setRefInitialized(true);
      }
    } else {
      // prd：直接标记已初始化，保持空选（不自动带资料）
      setRefInitialized(true);
    }
  }, [section, finalizedMats, refInitialized]);

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
  // 性能（修复大文档卡死）：PRD/CRD 首版或大改会产生大量 diff 块，行内高亮会为每块各渲染
  // 一个 ReactMarkdown → 主线程阻塞。超过阈值则跳过行内高亮，改普通渲染 + 提示去并排 Diff。
  const pendingBlockCount =
    ownPending?.diffBlocks?.filter((b) => b.state === "pending").length ?? 0;
  const INLINE_HL_LIMIT = 25;
  const useInlineHighlight = hasPendingHighlight && !!ownPending && pendingBlockCount <= INLINE_HL_LIMIT;

  // 问题1A：定向编辑的 pending 携带「修改后全文」(diff.newMd)。行内高亮的锚点基于“新行”，
  // 因此必须用 newMd 作为底稿渲染，才能把改动准确高亮在原文对应位置；否则锚点落空→无高亮。
  // 生成(create)类 pending 无 newMd，回落当前内容 shown（其本身即新文档）。
  const highlightContent =
    ((ownPending?.diff as any)?.newMd as string | undefined) ?? shown;
  // 渲染态实际展示的文档内容：用行内高亮时展示 newMd 预览，否则展示当前版本/草稿。
  const renderedDocContent = useInlineHighlight ? highlightContent : shown;
  // TOC 基于实际渲染内容解析（保证标题数与 DOM 中的 h1-h6 一一对应，供索引定位）。
  const toc = useMemo(() => parseToc(renderedDocContent), [renderedDocContent]);

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

  // 工件定稿（status → finalized，version+1，publish artifact.created）
  const finalize = useMutation({
    mutationFn: () =>
      artifact ? api.finalizeArtifact(pid, artifact.id) : Promise.resolve(null as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artifacts", pid, section] });
      qc.invalidateQueries({ queryKey: ["artifact-versions", artifact?.id] });
    },
  });

  // 解锁定稿（问题9）：status 置回 draft，version+1
  const unfinalize = useMutation({
    mutationFn: () =>
      artifact ? api.unfinalizeArtifact(pid, artifact.id) : Promise.resolve(null as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artifacts", pid, section] });
      qc.invalidateQueries({ queryKey: ["artifact-versions"] });
    },
  });

  // 版本回退：把选中的历史版本回退为新最高版（问题7）
  const rollback = useMutation({
    mutationFn: (toVersion: number) =>
      artifact ? api.rollback(artifact.id, toVersion) : Promise.resolve(null as any),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["artifacts", pid, section] });
      qc.invalidateQueries({ queryKey: ["artifact-versions", artifact?.id] });
      setDirty(false);
      if (res?.newVersion) setSelVer(res.newVersion);
    },
  });

  // 撤销（问题7）：把当前显示值压入 redo 栈，恢复到上一个 history 快照
  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      const cur = dirty ? draft : baseContent; // 撤销前的当前值进入 redo
      setRedo((r) => [...r, cur]);
      setDraft(prev);
      setDirty(true);
      return h.slice(0, -1);
    });
  };

  // 重做（问题7）：从 redo 栈弹出恢复，并把被恢复前的当前值压回 history
  const redoEdit = () => {
    setRedo((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      const cur = dirty ? draft : baseContent; // 重做前的当前值压回 history
      setHistory((h) => (h.length > 0 && h[h.length - 1] === cur ? h : [...h, cur]));
      setDraft(next);
      setDirty(true);
      return r.slice(0, -1);
    });
  };

  // 问题3：在渲染态 article 上划选文本 → 在选区附近弹出「引用到对话框」浮动按钮。
  const onArticleMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    const container = docScrollRef.current;
    const article = articleRef.current;
    if (!text || !sel || sel.rangeCount === 0 || !container || !article) {
      setQuoteBtn(null);
      return;
    }
    // 选区必须落在 article 内（避免选到其它区域）
    const range = sel.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) {
      setQuoteBtn(null);
      return;
    }
    // 选区矩形相对滚动容器的坐标（容器内绝对定位浮动按钮）
    const rect = range.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const top = rect.top - cRect.top + container.scrollTop - 34; // 浮在选区上方
    const left = rect.left - cRect.left + container.scrollLeft;
    setQuoteBtn({ text, top: Math.max(top, 0), left });
  };

  // 点击浮动按钮：把选中片段写入 store（供对话区显示引用 chip 并定向编辑），清理选区与按钮
  const applyQuote = () => {
    if (!quoteBtn) return;
    setQuote(quoteBtn.text);
    window.getSelection()?.removeAllRanges();
    setQuoteBtn(null);
  };

  // 导出文件名：优先工件标题，否则 section 大写
  const exportName = artifact?.title || section.toUpperCase();
  // doc/pdf 取已渲染 <article> 的 innerHTML 以保留排版；
  // 若当前不在渲染态（articleRef 不可用），回退为把源文本包进 <pre>。
  const exportInnerHtml = () =>
    articleRef.current?.innerHTML ??
    `<pre>${shown.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;

  // 切换 section 时，复位 view 模式（避免源码态残留到渲染态）
  useEffect(() => setView("render"), [section]);

  // 把「当前主区工件」写入 editTarget store，供对话区定向编辑定位目标（问题2）
  useEffect(() => {
    setEditTarget(section, artifact?.id ?? null);
    return () => setEditTarget(null, null);
  }, [section, artifact?.id, setEditTarget]);

  // 问题8：取文档滚动容器内所有标题元素（按文档顺序）。其索引与 toc 一一对应，
  // 同时兼容「普通渲染」与「InlineHighlightView 分段渲染」两条路径（都产出真实 h1-h6）。
  const getHeadingEls = (): HTMLElement[] => {
    const c = docScrollRef.current;
    return c ? Array.from(c.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")) : [];
  };

  // 点击目录：把文档容器滚动到第 idx 个标题（getBoundingClientRect 算容器内相对偏移，
  // 不依赖 offsetParent / heading id，彻底修复点击不跳转，问题2-1）。
  const scrollToHeading = (idx: number) => {
    const container = docScrollRef.current;
    if (!container) return;
    const el = getHeadingEls()[idx];
    if (!el) return;
    const top =
      el.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      12;
    container.scrollTo({ top, behavior: "smooth" });
  };

  // 问题8/2-2：滚动联动 — 仅渲染态时监听容器滚动，按 DOM 标题计算视口顶部对应的最近标题序号。
  useEffect(() => {
    const container = docScrollRef.current;
    if (view !== "render" || !container || toc.length === 0) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const els = getHeadingEls();
      if (els.length === 0) return;
      const cTop = container.getBoundingClientRect().top;
      let current = 0;
      for (let i = 0; i < els.length; i++) {
        const rel = els[i].getBoundingClientRect().top - cTop;
        if (rel <= 16) current = i; // 取顶部阈值内的最后一个标题
        else break;
      }
      setActiveIdx(current);
    };
    const onScroll = () => {
      if (raf) return; // 节流：每帧至多一次
      raf = requestAnimationFrame(compute);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    compute(); // 初次进入即定位一次
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [view, toc]);

  // 问题8：activeIdx 变化时把对应目录按钮在目录侧栏内居中（容器内相对滚动，不连带整页滚动）。
  useEffect(() => {
    if (activeIdx < 0) return;
    const aside = tocAsideRef.current;
    if (!aside) return;
    const btn = aside.querySelector<HTMLElement>(`[data-tocidx="${activeIdx}"]`);
    if (!btn) return;
    const target =
      btn.getBoundingClientRect().top -
      aside.getBoundingClientRect().top +
      aside.scrollTop -
      aside.clientHeight / 2 +
      btn.clientHeight / 2;
    aside.scrollTo({ top: target, behavior: "smooth" });
  }, [activeIdx]);

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
          {/* 选中历史版本时显示回退按钮：回退到 v{selVer} 为新最高版（问题7） */}
          {artifact && !isLatestSel && selVer != null && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => rollback.mutate(selVer)}
              disabled={rollback.isPending}
              title={`将 v${selVer} 回退为新最高版本`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {rollback.isPending ? "回退中…" : `回退到 v${selVer}`}
            </Button>
          )}
          {[Pencil, History, GitCompare].map((Icon, i) => (
            <button
              key={i}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-subtle text-text-secondary hover:bg-border/40"
              title="本期占位（TODO）"
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
          {/* 下载/导出下拉（问题4）：Markdown / Word(.doc) / PDF(打印) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-subtle text-text-secondary hover:bg-border/40 disabled:opacity-50"
                title="下载 / 导出"
                disabled={!artifact}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => downloadMarkdown(exportName, shown)}
              >
                下载 Markdown（.md）
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => exportDocFromHtml(exportName, exportInnerHtml(), exportName)}
              >
                另存为 Word（.doc）
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => exportPdfFromHtml(exportInnerHtml(), exportName)}
              >
                导出 PDF（打印）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* 定稿（问题6）：status==='finalized' 时显示「已定稿」且禁用 */}
          <Button
            variant="primary"
            size="sm"
            onClick={() => finalize.mutate()}
            disabled={!artifact || artifact.status === "finalized" || finalize.isPending}
            title={artifact?.status === "finalized" ? "已定稿" : "定稿（锁定为正式版本）"}
          >
            <Lock className="h-3.5 w-3.5" />
            {artifact?.status === "finalized"
              ? "已定稿"
              : finalize.isPending
              ? "定稿中…"
              : "定稿"}
          </Button>
          {/* 更多（问题9）：已定稿时提供「解锁定稿」；未定稿时显示禁用占位项 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-subtle text-text-secondary hover:bg-border/40 disabled:opacity-50"
                title="更多"
                disabled={!artifact}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {artifact?.status === "finalized" ? (
                <DropdownMenuItem
                  className="text-xs"
                  onSelect={() => unfinalize.mutate()}
                  disabled={unfinalize.isPending}
                >
                  <Unlock className="h-3.5 w-3.5" />
                  {unfinalize.isPending ? "解锁中…" : "🔓 解锁定稿"}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className="text-xs text-text-muted" disabled>
                  仅已定稿工件可解锁
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 参考资料栏（20260603）：默认加载已定稿资料，可下拉勾选（上传入口已移至资料阶段） */}
      <div className="border-y border-border bg-primary-subtle/30 px-5 py-2">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-semibold text-text-secondary">📎 参考资料</span>

          {/* 已选标签 */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {/* PRD 阶段：CRD 定稿文档自动关联（不可移除信息 chip，问题1） */}
            {section === "prd" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary-subtle border border-primary/30 px-2 py-0.5 text-[11px] font-medium text-primary">
                📎 CRD 定稿文档（自动关联）
              </span>
            )}
            {refIds.length === 0 && section !== "prd" ? (
              <span className="text-xs text-text-muted">未选择（默认使用全部已定稿资料）</span>
            ) : refIds.length === 0 && section === "prd" ? (
              <span className="text-xs text-text-muted">默认不带资料，可手动叠加勾选</span>
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
        </div>

        {/* PRD 阶段提示：已定稿 CRD 由后端作为主要参考资料（问题1/6） */}
        {section === "prd" &&
          (crdFinalized ? (
            <p className="mt-1.5 text-[11px] text-text-muted">
              PRD 将以已定稿 CRD 为主要参考资料
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] font-medium text-warning">
              ⚠ CRD 未定稿：建议先在 CRD 标签定稿，PRD 将以最新 CRD 生成
            </p>
          ))}
      </div>

      {/* 横切活动条（C 档：审查 / 安全 静态占位，TODO 真实数据源） */}
      <div className="flex items-center gap-4 border-y border-border bg-bg-subtle px-5 py-2 text-xs text-text-secondary">
        <span>🧐 审查 · 增量 PR#42 ◐ 进行中</span>
        <span className="h-3.5 w-px bg-border" />
        <span>🛡 安全 · SAST ✓ · SBOM ✓ · DPIA ◐</span>
        <span className="flex-1" />
        <span className="text-text-muted">TODO 真实数据源 · 失败项可跳转</span>
      </div>

      {/* Segmented + 撤销 + pending 汇总条 */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-1.5">
          <Segmented
            value={view}
            onChange={(v) => setView(v as ViewMode)}
            options={[
              { value: "render", label: "渲染" },
              { value: "source", label: "Markdown 源码" },
              { value: "diff",   label: "并排 Diff" },
            ]}
          />
          {/* 撤销：恢复草稿到上一步快照（栈空时禁用，问题7） */}
          <Button
            variant="outline"
            size="sm"
            onClick={undo}
            disabled={history.length === 0}
            title={history.length === 0 ? "无可撤销的编辑" : "撤销上一步编辑"}
          >
            <Undo2 className="h-3.5 w-3.5" /> 撤销
          </Button>
          {/* 重做：从重做栈恢复（栈空时禁用，问题7） */}
          <Button
            variant="outline"
            size="sm"
            onClick={redoEdit}
            disabled={redo.length === 0}
            title={redo.length === 0 ? "无可重做的编辑" : "重做下一步编辑"}
          >
            <Redo2 className="h-3.5 w-3.5" /> 重做
          </Button>
        </div>
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
        {/* TOC（问题8：点击跳转 + 滚动联动高亮 + 自动居中） */}
        <aside
          ref={tocAsideRef}
          className="sf-scroll w-52 shrink-0 space-y-0.5 overflow-y-auto border-r border-border bg-bg-subtle px-3 py-4"
        >
          <div className="flex items-center justify-between gap-1 pb-2">
            <span className="text-[11px] font-semibold text-text-muted">目录 · TOC</span>
          </div>
          {toc.length === 0 ? (
            <p className="px-2 text-[11px] text-text-muted">暂无目录（文档无标题）</p>
          ) : (
            toc.map((t, i) => {
              const isActive = activeIdx === i;
              return (
                <button
                  key={`${i}-${t.id}`}
                  data-tocidx={i}
                  onClick={() => {
                    // 点击即高亮并把文档容器滚动到第 i 个标题（索引定位，问题2-1）
                    setActiveIdx(i);
                    scrollToHeading(i);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-primary-subtle/60",
                    isActive && "bg-primary-subtle"
                  )}
                  style={{ paddingLeft: 8 + (t.level - 1) * 12 }}
                  title={t.label}
                >
                  <span
                    className={cn(
                      "truncate text-xs",
                      isActive
                        ? "font-semibold text-primary"
                        : t.level > 1
                        ? "text-text-muted"
                        : "text-text-secondary"
                    )}
                  >
                    {t.label}
                  </span>
                </button>
              );
            })
          )}
        </aside>

        {/* 文档主体：根据 view 切换 渲染/源码/Diff（ref 供 TOC 在本容器内精准滚动） */}
        <div
          ref={docScrollRef}
          className="sf-scroll relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-10 py-6"
        >
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
                // 把改动前的值压入撤销栈（与栈顶去重，避免连续输入塞满）
                const prev = shown;
                setHistory((h) =>
                  h.length > 0 && h[h.length - 1] === prev ? h : [...h, prev]
                );
                setRedo([]); // 新编辑产生新分支，清空重做栈（问题7）
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
          ) : useInlineHighlight && ownPending ? (
            // 渲染态行内高亮：以「修改后全文」(highlightContent) 为底稿，使改动准确高亮在原文位置（问题1A）
            <InlineHighlightView
              content={highlightContent}
              blocks={ownPending.diffBlocks!}
              cid={ownPending.id}
              onResolve={refreshAll}
              onGoDiff={() => setView("diff")}
            />
          ) : (
            <>
              {/* 块数过多（大文档）：跳过行内高亮以保证流畅，提示去并排 Diff 逐块确认 */}
              {hasPendingHighlight && ownPending && (
                <button
                  onClick={() => setView("diff")}
                  className="flex w-full items-center gap-2 rounded-md border border-pending bg-warning-subtle px-3 py-1.5 text-left text-xs font-medium text-warning hover:bg-warning-subtle/70"
                >
                  🟡 本次有 {pendingBlockCount} 处待确认改动，文档较大已切换为普通渲染以保证流畅；点此到「并排 Diff」逐块确认，或用上方「全部确认 / 全部拒绝」。
                </button>
              )}
              <article
                ref={articleRef}
                onMouseUp={onArticleMouseUp}
                className="prose prose-sm max-w-none text-text"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{shown}</ReactMarkdown>
              </article>
            </>
          )}

          {/* 问题3：划选引用浮动按钮（仅渲染态、有选区时出现，点击把片段引用到对话框） */}
          {view === "render" && quoteBtn && (
            <button
              onClick={applyQuote}
              className="absolute z-30 inline-flex items-center gap-1 rounded-md border border-primary bg-primary px-2 py-1 text-[11px] font-medium text-white shadow-lg hover:bg-primary/90"
              style={{ top: quoteBtn.top, left: quoteBtn.left }}
            >
              <Quote className="h-3 w-3" /> ✎ 引用到对话框修改
            </button>
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

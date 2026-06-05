"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Upload,
  FileText,
  Sparkles,
  Lock,
  Trash2,
  CheckSquare,
  Square,
  Languages,
  ListTree,
  ShieldAlert,
  BookOpen,
  MessageSquare,
  Check,
} from "lucide-react";
import { api, type MaterialDto, type UploadedFileDto } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

// 资料视图（20260603 改版）：两个顶级标签
// - 文件解析：上传 → 待解析列表（多选/全选）→ 批量解析 → 预览 → 对话补充 → 文件定稿
// - 内容解析：仅显示已定稿文件 → 翻译/索引/脱敏/知识库增强/对话修改 → 确认
// 真实数据：api.uploadFile / listFiles / parseMaterial / finalizeMaterial / transformMaterial

type TopTab = "file" | "content";

const TRANSLATE_OPS = [
  { op: "translate_en_zh", label: "英→中" },
  { op: "translate_fr_zh", label: "法→中" },
  { op: "translate_zh_en", label: "中→英" },
] as const;

function readinessTone(score: number): "success" | "warning" | "error" {
  return score >= 0.8 ? "success" : score >= 0.5 ? "warning" : "error";
}

/** 资料工件内容 → 可读正文。内容可能是结构化 JSON（含 raw_text）或纯文本（transform 结果）。 */
function parseDoc(content: string): { body: string; isJson: boolean; obj: any } {
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj === "object") {
      const raw = obj.raw_text ? String(obj.raw_text) : "";
      const body = raw.trim()
        ? raw
        : [obj.summary, ...(obj.key_points ?? [])].filter(Boolean).join("\n");
      return { body, isJson: true, obj };
    }
  } catch {
    /* 非 JSON，按纯文本处理 */
  }
  return { body: content ?? "", isJson: false, obj: null };
}

/** 主内容区文档面板：拉取工件最新内容，渲染/编辑（Markdown）+ 保存回写新版本。复用于两个标签。 */
function MaterialDocPanel({ pid, mid }: { pid: string; mid: string }) {
  const qc = useQueryClient();
  const [view, setView] = useState<"render" | "edit">("render");
  const [draft, setDraft] = useState<string | null>(null);

  const { data: art, isLoading } = useQuery({
    queryKey: ["material-doc", mid],
    queryFn: () => api.artifact(mid),
    enabled: !!mid,
  });

  const parsed = useMemo(() => parseDoc(art?.content ?? ""), [art?.content]);
  const shown = draft ?? parsed.body;
  const dirty = draft != null && draft !== parsed.body;

  // 切换文档时复位草稿与视图
  useEffect(() => {
    setDraft(null);
    setView("render");
  }, [mid]);

  const save = useMutation({
    mutationFn: () => {
      const version = art?.version ?? art?.currentVersion ?? 1;
      const newContent = parsed.isJson
        ? JSON.stringify({ ...parsed.obj, raw_text: shown })
        : shown;
      return api.updateArtifact(mid, newContent, version, "编辑正文");
    },
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["material-doc", mid] });
      qc.invalidateQueries({ queryKey: ["materials", pid] });
    },
  });

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">文档正文</h3>
        <div className="flex items-center gap-1.5">
          <Segmented
            value={view}
            onChange={(v) => setView(v as "render" | "edit")}
            options={[
              { value: "render", label: "渲染" },
              { value: "edit", label: "编辑" },
            ]}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
            title={dirty ? "保存为新版本" : "无改动"}
          >
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-[13px] text-text-muted">加载正文…</p>
      ) : view === "edit" ? (
        <textarea
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="sf-scroll min-h-[40vh] w-full resize-none whitespace-pre-wrap rounded-md border border-border bg-bg-subtle p-3 font-mono text-[13px] leading-relaxed text-text outline-none focus:border-primary"
        />
      ) : shown.trim() ? (
        <article className="prose prose-sm max-w-none rounded-md border border-border bg-bg p-4 text-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{shown}</ReactMarkdown>
        </article>
      ) : (
        <p className="rounded-md border border-border bg-bg p-4 text-[13px] text-text-muted">
          （暂无可渲染的正文内容）
        </p>
      )}
    </section>
  );
}

export function MaterialView() {
  const { pid } = useParams<{ pid: string }>();
  const [tab, setTab] = useState<TopTab>("file");

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-bg">
      {/* 顶级标签：文件解析 / 内容解析 */}
      <div className="flex items-end gap-1 border-b border-border px-4 pt-1.5">
        {[
          { key: "file" as const, label: "📂 文件解析" },
          { key: "content" as const, label: "🔍 内容解析" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative -mb-px px-4 pb-2 pt-2 text-[13px] border-b-2 transition-colors",
              tab === t.key
                ? "border-primary font-semibold text-primary"
                : "border-transparent text-text-secondary hover:text-text"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "file" ? <FileParseTab pid={pid} /> : <ContentParseTab pid={pid} />}
    </div>
  );
}

// ===========================================================================
// 标签一：文件解析
// ===========================================================================
function FileParseTab({ pid }: { pid: string }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeMat, setActiveMat] = useState<string | null>(null);
  // 每文件解析进度：fid → 0..100（解析中显示进度条；done 后从待解析消失）
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [parsing, setParsing] = useState(false);

  const { data: files } = useQuery({
    queryKey: ["files", pid],
    queryFn: () => api.listFiles(pid),
    enabled: !!pid,
  });
  const { data: mats } = useQuery({
    queryKey: ["materials", pid],
    queryFn: () => api.materials(pid),
    enabled: !!pid,
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadFile(pid, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["files", pid] }),
  });
  const del = useMutation({
    mutationFn: (fid: string) => api.deleteFile(pid, fid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["files", pid] }),
  });
  // 删除已解析资料（连原文件 + artifact）；两个 Tab 共用 materials query，删后同步消失
  const delMaterial = useMutation({
    mutationFn: (mid: string) => api.deleteMaterial(pid, mid),
    onSuccess: (_r, mid) => {
      if (activeMat === mid) setActiveMat(null);
      qc.invalidateQueries({ queryKey: ["materials", pid] });
      qc.invalidateQueries({ queryKey: ["files", pid] });
    },
  });

  // 批量解析：逐文件串行，更新每文件进度条；完成后文件 status→parsed 自动移出待解析、进入已完成列表
  const runParse = async (fids: string[]) => {
    if (fids.length === 0) return;
    setParsing(true);
    setProgress(Object.fromEntries(fids.map((f) => [f, 5])));
    for (const fid of fids) {
      try {
        // 平滑推进到 60%（真实抽取在后端，前端只表现进度感）
        setProgress((p) => ({ ...p, [fid]: 40 }));
        await api.parseMaterial(pid, { file_id: fid });
        setProgress((p) => ({ ...p, [fid]: 100 }));
      } catch {
        setProgress((p) => ({ ...p, [fid]: -1 })); // -1 = 失败
      }
    }
    setSelected(new Set());
    await qc.invalidateQueries({ queryKey: ["files", pid] });
    await qc.invalidateQueries({ queryKey: ["materials", pid] });
    // 解析完成后清掉进度（文件已转入已完成列表）
    setTimeout(() => setProgress({}), 800);
    setParsing(false);
  };

  const finalize = useMutation({
    mutationFn: (mid: string) => api.finalizeMaterial(pid, mid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["materials", pid] }),
  });

  const fileList = (files ?? []) as UploadedFileDto[];
  const matList = (mats ?? []) as MaterialDto[];
  // 待解析 = 尚未关联 parsedArtifactId 的上传文件
  const pendingFiles = fileList.filter((f) => f.status === "uploaded");
  const active = matList.find((m) => m.id === activeMat) ?? null;

  const toggle = (fid: string) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(fid) ? n.delete(fid) : n.add(fid);
      return n;
    });
  };
  const toggleAll = () => {
    setSelected((s) =>
      s.size === pendingFiles.length ? new Set() : new Set(pendingFiles.map((f) => f.id))
    );
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* 左列：上传 + 待解析列表（多选） */}
      <aside className="sf-scroll w-[320px] shrink-0 space-y-3 overflow-y-auto border-r border-border bg-bg-subtle p-4">
        {/* 上传区 */}
        <div
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            Array.from(e.dataTransfer.files).forEach((f) => upload.mutate(f));
          }}
          className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[10px] border-2 border-dashed border-primary/50 bg-bg p-5 text-center transition-colors hover:border-primary hover:bg-primary-subtle/30"
        >
          <Upload className="h-5 w-5 text-primary" />
          <span className="text-xs font-semibold text-primary">点击或拖拽上传文件</span>
          <span className="text-[10px] text-text-muted">临时存储，保留最近 7 天</span>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              Array.from(e.target.files ?? []).forEach((f) => upload.mutate(f));
              e.target.value = "";
            }}
          />
        </div>
        {upload.isPending && <p className="text-[11px] text-primary">上传中…</p>}

        {/* 待解析列表 */}
        <div className="flex items-center justify-between text-xs font-semibold text-text-muted">
          <span>待解析 · {pendingFiles.length}</span>
          {pendingFiles.length > 0 && (
            <button
              onClick={toggleAll}
              className="flex items-center gap-1 text-primary hover:underline"
            >
              {selected.size === pendingFiles.length ? (
                <CheckSquare className="h-3.5 w-3.5" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              全选
            </button>
          )}
        </div>

        {pendingFiles.length === 0 ? (
          <p className="text-[11px] text-text-muted">暂无待解析文件，先上传。</p>
        ) : (
          pendingFiles.map((f) => (
            <div
              key={f.id}
              className={cn(
                "space-y-1.5 rounded-md border border-border bg-bg p-2.5 transition-colors",
                selected.has(f.id) && "border-primary ring-1 ring-primary/30"
              )}
            >
              <div className="flex items-center gap-2">
                <button onClick={() => toggle(f.id)} className="text-primary">
                  {selected.has(f.id) ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4 text-text-muted" />
                  )}
                </button>
                <FileText className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-text" title={f.name}>
                  {f.name}
                </span>
                <button
                  onClick={() => del.mutate(f.id)}
                  className="text-text-muted hover:text-error"
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* 解析进度条（解析中显示；-1=失败） */}
              {progress[f.id] !== undefined && (
                <div className="space-y-0.5">
                  <div className="h-1 w-full overflow-hidden rounded-full bg-bg-subtle">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        progress[f.id] < 0 ? "bg-error" : "bg-primary"
                      )}
                      style={{ width: `${progress[f.id] < 0 ? 100 : progress[f.id]}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-text-muted">
                    {progress[f.id] < 0
                      ? "解析失败"
                      : progress[f.id] >= 100
                      ? "解析完成 ✓"
                      : `解析中… ${progress[f.id]}%`}
                  </span>
                </div>
              )}
            </div>
          ))
        )}

        {/* 批量解析按钮 */}
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          disabled={selected.size === 0 || parsing}
          onClick={() => runParse(Array.from(selected))}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {parsing ? "解析中…" : `批量解析（${selected.size}）`}
        </Button>

        {/* 已完成解析（可预览/定稿/删除） */}
        <div className="border-t border-border pt-3 text-xs font-semibold text-text-muted">
          已完成解析 · {matList.length}
        </div>
        {matList.length === 0 && (
          <p className="text-[11px] text-text-muted">解析完成的文件会出现在这里。</p>
        )}
        {matList.map((m) => (
          <div
            key={m.id}
            className={cn(
              "group flex items-center gap-2 rounded-md border border-border bg-bg p-2.5 transition-colors hover:border-primary",
              activeMat === m.id && "border-primary ring-1 ring-primary/30"
            )}
          >
            <button
              onClick={() => setActiveMat(m.id)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
                {m.title}
              </span>
              {m.status === "finalized" ? (
                <Badge tone="success" className="text-[10px]">✓ 已定稿</Badge>
              ) : (
                <Badge tone={readinessTone(m.readinessScore)} className="text-[10px]">初稿</Badge>
              )}
            </button>
            <button
              onClick={() => {
                if (confirm(`删除「${m.title}」？将同时删除原文件，且无法恢复。`))
                  delMaterial.mutate(m.id);
              }}
              className="shrink-0 text-text-muted opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
              title="删除（连原文件）"
              disabled={delMaterial.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </aside>

      {/* 右列：解析初稿预览 + 对话补充 + 定稿 */}
      <div className="sf-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-7 py-5">
        {!active ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            从左侧上传文件并解析后，点击解析初稿查看详情。
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="text-lg">📄</span>
                <h1 className="truncate text-xl font-semibold text-text">{active.title}</h1>
                {active.status === "finalized" ? (
                  <Badge tone="success">✓ 已定稿</Badge>
                ) : (
                  <Badge tone={readinessTone(active.readinessScore)}>
                    初稿 · {(active.readinessScore * 100).toFixed(0)}%
                  </Badge>
                )}
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={active.status === "finalized" || finalize.isPending}
                onClick={() => finalize.mutate(active.id)}
              >
                <Lock className="h-3.5 w-3.5" />
                {active.status === "finalized" ? "已定稿" : "文件解析定稿"}
              </Button>
            </div>

            {/* 文档正文：主内容区渲染 + 编辑（可保存为新版本） */}
            <MaterialDocPanel pid={pid} mid={active.id} />

            {/* 解析摘要 */}
            {active.summary && (
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-text">解析摘要</h3>
                <p className="text-[13px] leading-relaxed text-text-secondary">{active.summary}</p>
              </section>
            )}

            {/* 关键点 */}
            {active.keyPoints && active.keyPoints.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-text">关键点</h3>
                <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-text-secondary">
                  {active.keyPoints.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* 缺口（提示可通过对话补充解析） */}
            {active.missingItems && active.missingItems.length > 0 && (
              <section className="space-y-1.5 rounded-md border border-l-[3px] border-error/40 bg-error-subtle p-3">
                <div className="text-[11px] font-semibold text-error">⚠ 缺口（可在右侧对话区补充解析）</div>
                <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-error">
                  {active.missingItems.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* 对话补充提示 */}
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle p-3 text-[13px] text-text-secondary">
              <MessageSquare className="h-4 w-4 text-info" />
              解析不对或有遗漏？在右侧对话区让 Agent 重新解析或补充，确认无误后点「文件解析定稿」。
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// 标签二：内容解析（仅已定稿文件）
// ===========================================================================
function ContentParseTab({ pid }: { pid: string }) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: mats } = useQuery({
    queryKey: ["materials", pid],
    queryFn: () => api.materials(pid),
    enabled: !!pid,
  });

  const transform = useMutation({
    mutationFn: ({ mid, op }: { mid: string; op: string }) =>
      api.transformMaterial(pid, mid, op),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["materials", pid] });
      qc.invalidateQueries({ queryKey: ["material-doc", activeId] });
    },
  });
  // 内容解析定稿（独立于文件解析定稿）
  const finalizeContent = useMutation({
    mutationFn: (mid: string) => api.finalizeContentMaterial(pid, mid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["materials", pid] }),
  });
  // 删除（连原文件）；与文件解析 Tab 共用 materials query，删后同步消失
  const delMaterial = useMutation({
    mutationFn: (mid: string) => api.deleteMaterial(pid, mid),
    onSuccess: (_r, mid) => {
      if (activeId === mid) setActiveId(null);
      qc.invalidateQueries({ queryKey: ["materials", pid] });
      qc.invalidateQueries({ queryKey: ["files", pid] });
    },
  });

  const matList = (mats ?? []) as MaterialDto[];
  // 内容解析操作对象 = 文件解析已定稿（status=finalized）的文件
  const finalizedList = matList.filter((m) => m.status === "finalized");
  const active = finalizedList.find((m) => m.id === activeId) ?? null;

  const ACTIONS = [
    { icon: ListTree, label: "建立索引", op: "index", tone: "text-info" },
    { icon: ShieldAlert, label: "脱敏处理", op: "desensitize", tone: "text-warning" },
    { icon: BookOpen, label: "知识库增强", op: "enrich", tone: "text-success" },
  ];

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* 左列：已定稿文件（只读） */}
      <aside className="sf-scroll w-[300px] shrink-0 space-y-2 overflow-y-auto border-r border-border bg-bg-subtle p-4">
        <div className="text-xs font-semibold text-text-muted">
          已定稿文件 · {finalizedList.length}
        </div>
        {finalizedList.length === 0 ? (
          <p className="text-[11px] text-text-muted">
            暂无已定稿文件。请先在「文件解析」标签中完成定稿。
          </p>
        ) : (
          finalizedList.map((m) => (
            <div
              key={m.id}
              className={cn(
                "group flex items-center gap-2 rounded-md border border-border bg-bg p-2.5 transition-colors hover:border-primary",
                activeId === m.id && "border-primary ring-1 ring-primary/30"
              )}
            >
              <button
                onClick={() => {
                  setActiveId(m.id);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <FileText className="h-3.5 w-3.5 text-text-secondary" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
                  {m.title}
                </span>
                {m.contentParsed ? (
                  <Badge tone="success" className="text-[10px]">✓ 内容定稿</Badge>
                ) : (
                  <Badge tone="warning" className="text-[10px]">待内容解析</Badge>
                )}
              </button>
              <button
                onClick={() => {
                  if (confirm(`删除「${m.title}」？将同时删除原文件，且无法恢复。`))
                    delMaterial.mutate(m.id);
                }}
                className="shrink-0 text-text-muted opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                title="删除（连原文件，文件解析 Tab 同步移除）"
                disabled={delMaterial.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </aside>

      {/* 右列：内容解析操作面板 */}
      <div className="sf-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-7 py-5">
        {!active ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            从左侧选择一个已定稿文件，按需进行翻译 / 索引 / 脱敏 / 知识库增强。
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              <span className="text-lg">🔍</span>
              <h1 className="truncate text-xl font-semibold text-text">{active.title}</h1>
              {active.contentParsed ? (
                <Badge tone="success">✓ 内容解析已定稿</Badge>
              ) : (
                <Badge tone="warning">待内容解析定稿</Badge>
              )}
            </div>

            {/* 文档正文：主内容区渲染 + 编辑（占主要空间，不被操作区遮挡） */}
            <MaterialDocPanel pid={pid} mid={active.id} />

            {/* 内容解析操作区：统一收进一张卡片，置于正文之后 */}
            <div className="space-y-3 rounded-lg border border-border bg-bg-subtle/60 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">内容解析操作</h3>
                <span className="text-[11px] text-text-muted">
                  按需点击；处理结果写入新版本并更新上方正文
                </span>
              </div>

              {/* 翻译 */}
              <section className="space-y-2">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-text">
                  <Languages className="h-4 w-4 text-primary" /> 翻译
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TRANSLATE_OPS.map((t) => (
                    <Button
                      key={t.op}
                      variant="secondary"
                      size="sm"
                      disabled={transform.isPending}
                      onClick={() => transform.mutate({ mid: active.id, op: t.op })}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </section>

              {/* 索引 / 脱敏 / 知识库增强 */}
              <section className="grid grid-cols-3 gap-2.5">
                {ACTIONS.map((a) => (
                  <button
                    key={a.op}
                    disabled={transform.isPending}
                    onClick={() => transform.mutate({ mid: active.id, op: a.op })}
                    className="flex flex-col items-center gap-1.5 rounded-md border border-border bg-bg p-3 transition-colors hover:border-primary disabled:opacity-50"
                  >
                    <a.icon className={cn("h-5 w-5", a.tone)} />
                    <span className="text-[12px] font-medium text-text">{a.label}</span>
                  </button>
                ))}
              </section>

              {transform.isPending && <p className="text-[13px] text-primary">处理中…</p>}

              {/* 对话修改提示 + 确认定稿 */}
              <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                <span className="flex items-center gap-2 text-[12px] text-text-secondary">
                  <MessageSquare className="h-4 w-4 text-info" />
                  也可在右侧对话区对内容任意修改
                </span>
                <Button
                  variant="success"
                  size="sm"
                  disabled={active.contentParsed || finalizeContent.isPending}
                  onClick={() => finalizeContent.mutate(active.id)}
                  title="内容解析定稿（独立于文件解析定稿；定稿后可作为需求阶段参考资料）"
                >
                  <Check className="h-3.5 w-3.5" />
                  {active.contentParsed
                    ? "已定稿"
                    : finalizeContent.isPending
                    ? "定稿中…"
                    : "确认内容解析完成"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

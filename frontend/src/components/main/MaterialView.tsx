"use client";

import { useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  const parse = useMutation({
    mutationFn: (fids: string[]) =>
      Promise.all(fids.map((fid) => api.parseMaterial(pid, { file_id: fid }))),
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["files", pid] });
      qc.invalidateQueries({ queryKey: ["materials", pid] });
    },
  });
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
                "flex items-center gap-2 rounded-md border border-border bg-bg p-2.5 transition-colors",
                selected.has(f.id) && "border-primary ring-1 ring-primary/30"
              )}
            >
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
          ))
        )}

        {/* 批量解析按钮 */}
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          disabled={selected.size === 0 || parse.isPending}
          onClick={() => parse.mutate(Array.from(selected))}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {parse.isPending ? "解析中…" : `批量解析（${selected.size}）`}
        </Button>

        {/* 已解析资料（可定稿） */}
        <div className="border-t border-border pt-3 text-xs font-semibold text-text-muted">
          解析初稿 · {matList.length}
        </div>
        {matList.map((m) => (
          <button
            key={m.id}
            onClick={() => setActiveMat(m.id)}
            className={cn(
              "w-full space-y-1 rounded-md border border-border bg-bg p-2.5 text-left transition-colors hover:border-primary",
              activeMat === m.id && "border-primary ring-1 ring-primary/30"
            )}
          >
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-text-secondary" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
                {m.title}
              </span>
              {m.status === "finalized" ? (
                <Badge tone="success" className="text-[10px]">
                  ✓ 已定稿
                </Badge>
              ) : (
                <Badge tone={readinessTone(m.readinessScore)} className="text-[10px]">
                  初稿
                </Badge>
              )}
            </div>
          </button>
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
  const [result, setResult] = useState<string>("");

  const { data: mats } = useQuery({
    queryKey: ["materials", pid],
    queryFn: () => api.materials(pid),
    enabled: !!pid,
  });

  const transform = useMutation({
    mutationFn: ({ mid, op }: { mid: string; op: string }) =>
      api.transformMaterial(pid, mid, op),
    onSuccess: (r) => {
      setResult(r.content);
      qc.invalidateQueries({ queryKey: ["materials", pid] });
    },
  });

  const matList = (mats ?? []) as MaterialDto[];
  // 内容解析只能操作已定稿文件
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
            <button
              key={m.id}
              onClick={() => {
                setActiveId(m.id);
                setResult("");
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border border-border bg-bg p-2.5 text-left transition-colors hover:border-primary",
                activeId === m.id && "border-primary ring-1 ring-primary/30"
              )}
            >
              <FileText className="h-3.5 w-3.5 text-text-secondary" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
                {m.title}
              </span>
              <Badge tone="success" className="text-[10px]">
                ✓
              </Badge>
            </button>
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
              <Badge tone="success">✓ 已定稿</Badge>
            </div>
            <p className="text-[13px] text-text-muted">
              以下操作均非固定流程，按需点击；不需要修改时直接点右下「确认」。
            </p>

            {/* 翻译 */}
            <section className="space-y-2 rounded-md border border-border bg-bg-subtle p-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-text">
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
                  className="flex flex-col items-center gap-1.5 rounded-md border border-border bg-bg p-4 transition-colors hover:border-primary disabled:opacity-50"
                >
                  <a.icon className={cn("h-5 w-5", a.tone)} />
                  <span className="text-[13px] font-medium text-text">{a.label}</span>
                </button>
              ))}
            </section>

            {/* 对话修改提示 */}
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle p-3 text-[13px] text-text-secondary">
              <MessageSquare className="h-4 w-4 text-info" />
              还可在右侧对话区对该文件内容进行任意修改。
            </div>

            {/* 结果预览 */}
            {transform.isPending && <p className="text-[13px] text-primary">处理中…</p>}
            {result && (
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold text-text">处理结果（已写入新版本）</h3>
                <pre className="sf-scroll max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-bg-subtle p-3 text-[13px] leading-relaxed text-text-secondary">
                  {result}
                </pre>
              </section>
            )}

            {/* 确认按钮 */}
            <div className="mt-auto flex justify-end pt-2">
              <Button variant="success" size="sm">
                <Check className="h-3.5 w-3.5" /> 确认内容解析完成
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

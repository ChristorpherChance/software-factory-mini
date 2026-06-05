"use client";

import { useMemo } from "react";
import { Check, X, GitCompare } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type DiffBlockDto } from "@/lib/api";
import { cn } from "@/lib/utils";
import { KIND_STYLE } from "./DiffBlockView";

// 渲染态行内高亮：把 pending 的 diffBlocks（add/del/mod）就近叠加到 Markdown 渲染上。
// - add/mod：用块的「新内容行」在文档中顺序锚定，命中区间套 add(绿)/mod(黄) 配色 + 角标。
// - del：被删除原文在新文档中无位置，按顺序就近插入，以删除线红字展示。
// - 逐块 ✓/✗ 调 api.resolveBlock；确认后该块 state≠pending → 下次渲染被过滤 → 高亮消失（纯数据驱动）。
// - 无法锚定的块收进顶部汇总，提示切到「并排 Diff」查看，避免丢失变更。

type Seg =
  | { type: "plain"; text: string }
  | { type: "hl"; block: DiffBlockDto; text: string; removed: string[] };

const stripPlus = (l: string) => (l.startsWith("+ ") ? l.slice(2) : l);
const stripMinus = (l: string) => (l.startsWith("- ") ? l.slice(2) : l);

/** 在 hay 中从 from 起查找与 needle 完全相等的连续子序列起点；找不到返回 -1。 */
function findSubsequence(hay: string[], needle: string[], from: number): number {
  if (needle.length === 0) return -1;
  outer: for (let i = Math.max(0, from); i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) {
      if (hay[i + k] !== needle[k]) continue outer;
    }
    return i;
  }
  return -1;
}

function buildSegments(
  content: string,
  pendingBlocks: DiffBlockDto[]
): { segs: Seg[]; unaligned: DiffBlockDto[] } {
  const docLines = content.split("\n");
  const owner = new Array<DiffBlockDto | null>(docLines.length).fill(null);
  const unaligned: DiffBlockDto[] = [];
  const delAt: Record<number, DiffBlockDto[]> = {};
  let cursor = 0;

  for (const b of pendingBlocks) {
    if (b.kind === "del") {
      (delAt[cursor] ||= []).push(b);
      continue;
    }
    const anchor =
      b.kind === "mod"
        ? b.lines.filter((l) => l.startsWith("+ ")).map(stripPlus)
        : b.lines.slice();
    if (anchor.length === 0) {
      unaligned.push(b);
      continue;
    }
    const start = findSubsequence(docLines, anchor, cursor);
    if (start < 0) {
      unaligned.push(b);
      continue;
    }
    for (let k = start; k < start + anchor.length; k++) owner[k] = b;
    cursor = start + anchor.length;
  }

  const segs: Seg[] = [];
  const pushDelAt = (idx: number) => {
    for (const b of delAt[idx] ?? []) {
      segs.push({ type: "hl", block: b, text: "", removed: b.lines.map(stripMinus) });
    }
  };

  let i = 0;
  while (i < docLines.length) {
    pushDelAt(i);
    const o = owner[i];
    let j = i;
    while (j < docLines.length && owner[j] === o) j++;
    const text = docLines.slice(i, j).join("\n");
    if (o === null) {
      segs.push({ type: "plain", text });
    } else {
      const removed =
        o.kind === "mod"
          ? o.lines.filter((l) => l.startsWith("- ")).map(stripMinus)
          : [];
      segs.push({ type: "hl", block: o, text, removed });
    }
    i = j;
  }
  pushDelAt(docLines.length);
  return { segs, unaligned };
}

export function InlineHighlightView({
  content,
  blocks,
  cid,
  onResolve,
  onGoDiff,
}: {
  content: string;
  blocks: DiffBlockDto[];
  cid: string;
  onResolve: () => void;
  onGoDiff: () => void;
}) {
  const pendingBlocks = useMemo(
    () => blocks.filter((b) => b.state === "pending"),
    [blocks]
  );
  const { segs, unaligned } = useMemo(
    () => buildSegments(content, pendingBlocks),
    [content, pendingBlocks]
  );

  return (
    <div className="space-y-1.5">
      {unaligned.length > 0 && (
        <button
          onClick={onGoDiff}
          className="flex w-full items-center gap-2 rounded-md border border-pending bg-warning-subtle px-3 py-1.5 text-left text-xs font-medium text-warning hover:bg-warning-subtle/70"
        >
          <GitCompare className="h-3.5 w-3.5" />
          {unaligned.length} 处变更无法在正文定位，点此切到「并排 Diff」逐块查看 →
        </button>
      )}
      {segs.map((seg, idx) =>
        seg.type === "plain" ? (
          seg.text.trim() === "" ? null : (
            <article
              key={idx}
              className="prose prose-sm max-w-none text-text"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>
            </article>
          )
        ) : (
          <HlSegment key={idx} seg={seg} cid={cid} onResolve={onResolve} />
        )
      )}
    </div>
  );
}

function HlSegment({
  seg,
  cid,
  onResolve,
}: {
  seg: Extract<Seg, { type: "hl" }>;
  cid: string;
  onResolve: () => void;
}) {
  const s = KIND_STYLE[seg.block.kind];
  const resolved = seg.block.state !== "pending";
  const resolve = useMutation({
    mutationFn: (state: "confirmed" | "rejected") =>
      api.resolveBlock(cid, seg.block.id, state),
    onSuccess: onResolve,
  });

  return (
    <div
      className={cn(
        "group relative rounded-md border-l-[3px] border-border py-1 pl-3 pr-2 transition-opacity",
        s.wrap,
        resolved && "opacity-60"
      )}
    >
      <div className="mb-0.5 flex items-center justify-between">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold text-white",
            s.tag
          )}
        >
          {seg.block.tag}
        </span>
        {!resolved && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => resolve.mutate("confirmed")}
              disabled={resolve.isPending}
              className="flex h-5 w-5 items-center justify-center rounded bg-success text-white disabled:opacity-50"
              title="确认本处改动（确认后高亮消失）"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onClick={() => resolve.mutate("rejected")}
              disabled={resolve.isPending}
              className="flex h-5 w-5 items-center justify-center rounded border border-border bg-bg-elevated text-error disabled:opacity-50"
              title="拒绝本处改动"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      {seg.removed.length > 0 && (
        <div className="mb-1 space-y-0.5">
          {seg.removed.map((ln, i) => (
            <p
              key={i}
              className="whitespace-pre-wrap text-sm leading-relaxed text-diff-del line-through"
            >
              {ln}
            </p>
          ))}
        </div>
      )}
      {seg.text.trim() !== "" && (
        <article className="prose prose-sm max-w-none text-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}

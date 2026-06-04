"use client";

import { Check, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type DiffBlockDto } from "@/lib/api";
import { cn } from "@/lib/utils";

// DiffBlockView：照搬原型 KIND_STYLE（add/del/mod 三态）+ 逐块 ✓/✗ + resolved 半透明
// 调 api.resolveBlock；成功后 invalidate ["pending-changes"] / ["artifact"]（三处同步）。

const KIND_STYLE: Record<
  DiffBlockDto["kind"],
  { wrap: string; tag: string; text: string; prefix: string; strike?: boolean }
> = {
  add: {
    wrap: "bg-success-subtle border-l-diff-add",
    tag: "bg-diff-add",
    text: "text-diff-add",
    prefix: "+ ",
  },
  del: {
    wrap: "bg-error-subtle border-l-diff-del",
    tag: "bg-diff-del",
    text: "text-diff-del",
    prefix: "",
    strike: true,
  },
  mod: {
    wrap: "bg-warning-subtle border-l-diff-mod",
    tag: "bg-diff-mod",
    text: "text-text",
    prefix: "",
  },
};

export function DiffBlockView({
  cid,
  block,
}: {
  cid: string;
  block: DiffBlockDto;
}) {
  const qc = useQueryClient();
  const s = KIND_STYLE[block.kind];

  const resolve = useMutation({
    mutationFn: (state: "confirmed" | "rejected") =>
      api.resolveBlock(cid, block.id, state),
    onSuccess: () => {
      // pending-changes 列表 + 单条详情 + artifact（如有内容回写）三处同步
      qc.invalidateQueries({ queryKey: ["pending-changes"] });
      qc.invalidateQueries({ queryKey: ["artifact"] });
      qc.invalidateQueries({ queryKey: ["artifacts"] });
    },
  });

  const resolved = block.state !== "pending";

  return (
    <div
      className={cn(
        "space-y-2 rounded-md border border-l-[3px] border-border p-3.5 transition-opacity",
        s.wrap,
        resolved && "opacity-60"
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px] font-semibold text-white",
            s.tag
          )}
        >
          {block.tag}
        </span>
        {block.state === "pending" ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => resolve.mutate("confirmed")}
              disabled={resolve.isPending}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-success text-white disabled:opacity-50"
              title="确认本块（按块 resolve）"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onClick={() => resolve.mutate("rejected")}
              disabled={resolve.isPending}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-bg-elevated text-error disabled:opacity-50"
              title="拒绝本块"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <span className="text-[11px] font-medium text-text-muted">
            {block.state === "confirmed" ? "✓ 已确认" : "✗ 已弃用"}
          </span>
        )}
      </div>
      {block.lines.map((ln, i) => (
        <p
          key={i}
          className={cn(
            "whitespace-pre-wrap text-sm leading-relaxed",
            s.text,
            s.strike && "line-through"
          )}
        >
          {s.prefix}
          {ln}
        </p>
      ))}
    </div>
  );
}

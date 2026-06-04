"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FinalizeButton } from "./FinalizeButton";

const MARK = (ok: boolean) => (ok ? "✅" : "❌");

export function SelfCheckPanel({ pid, sid }: { pid: string; sid: string }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api.selfcheck(pid, sid),
    onSuccess: () => {
      // 自检会产出报告工件并影响 RTM，刷新相关查询
      qc.invalidateQueries({ queryKey: ["rtm", pid] });
      qc.invalidateQueries({ queryKey: ["artifacts", pid] });
    },
  });
  const r = run.data;

  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-text">需求自检</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => run.mutate()}
          disabled={run.isPending}
        >
          {run.isPending ? "检查中…" : "运行自检"}
        </Button>
      </div>

      {run.isError && (
        <p className="mb-2 text-xs text-error">自检失败（后端不可达）。</p>
      )}

      {r && (
        <ul className="mb-3 space-y-1 text-sm">
          {r.checks.map((c) => (
            <li key={c.name} className="flex items-center justify-between">
              <span>
                {MARK(c.pass)} {c.name}
              </span>
              {c.name === "testability" && typeof c.coverage === "number" && (
                <span className="text-text-secondary">
                  覆盖 {(c.coverage * 100).toFixed(0)}%
                </span>
              )}
              {c.name === "completeness" && c.missing && c.missing.length > 0 && (
                <span className="text-xs text-error">缺 {c.missing.length}</span>
              )}
              {c.name === "consistency" && c.orphans && c.orphans.length > 0 && (
                <span className="text-xs text-error">孤儿 {c.orphans.length}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <FinalizeButton pid={pid} sid={sid} allGreen={!!r?.allGreen} />
    </div>
  );
}

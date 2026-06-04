"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTraceStore } from "@/stores/trace";
import { cn } from "@/lib/utils";

// 覆盖率热力单元
function cellCls(v: number) {
  return v >= 0.85
    ? "bg-success-subtle text-success"
    : v >= 0.7
    ? "bg-warning-subtle text-warning"
    : "bg-error-subtle text-error";
}

export default function MatrixPage() {
  const { pid } = useParams<{ pid: string }>();
  const hydrate = useTraceStore((s) => s.hydrate);

  const { data: r, isLoading } = useQuery({
    queryKey: ["rtm", pid],
    queryFn: () => api.rtm(pid),
    enabled: !!pid,
  });

  // 把健康分写入 traceStore，供 TopBar 🔗 徽标读取
  useEffect(() => {
    if (r) hydrate(r);
  }, [r, hydrate]);

  if (isLoading) {
    return <div className="p-6 text-text-muted">加载追溯矩阵…</div>;
  }
  if (!r) {
    return <div className="p-6 text-text-muted">暂无追溯数据。</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <section>
        <h3 className="mb-2 font-semibold text-text">
          覆盖率（健康分 {((r.healthScore ?? 0) * 100).toFixed(0)}%）
        </h3>
        <table className="w-full overflow-hidden rounded-lg border border-border text-sm">
          <thead className="bg-bg-subtle">
            <tr>
              <th className="px-3 py-2 text-left">层</th>
              <th className="px-3 py-2">L0a ORD→CRD</th>
              <th className="px-3 py-2">L0b CRD→PRD</th>
              <th className="px-3 py-2">L0c PRD→设计</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="px-3 py-2 text-text-secondary">覆盖率</td>
              <td className={cn("px-3 py-2 text-center font-mono", cellCls(r.L0a ?? 0))}>
                {((r.L0a ?? 0) * 100).toFixed(0)}%
              </td>
              <td className={cn("px-3 py-2 text-center font-mono", cellCls(r.L0b ?? 0))}>
                {((r.L0b ?? 0) * 100).toFixed(0)}%
              </td>
              <td className={cn("px-3 py-2 text-center font-mono", cellCls(r.L0c ?? 0))}>
                {((r.L0c ?? 0) * 100).toFixed(0)}%
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {r.byLayer && Object.keys(r.byLayer).length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold text-text">分层覆盖</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(r.byLayer).map(([layer, v]) => (
              <span
                key={layer}
                className={cn(
                  "rounded-md px-2 py-1 font-mono text-xs",
                  cellCls(Number(v))
                )}
              >
                {layer}: {(Number(v) * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 font-semibold text-error">
          孤儿节点（{r.orphans?.length ?? 0}）
        </h3>
        <div className="flex flex-wrap gap-2">
          {(r.orphans ?? []).map((c) => (
            <span
              key={c}
              className="rounded-md bg-error-subtle px-2 py-1 text-xs text-error"
            >
              {c}
            </span>
          ))}
          {(r.orphans?.length ?? 0) === 0 && (
            <span className="text-sm text-success">无孤儿，链路完整 ✅</span>
          )}
        </div>
      </section>
    </div>
  );
}

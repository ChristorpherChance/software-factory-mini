"use client";

import { useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, RotateCw, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { useHitlStore } from "@/stores/hitl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// pending 三处联动（对话区按钮 / 工件高亮 / 矩阵）：
// 确认/拒绝后失效 artifact / pending-changes / rtm 查询，触发各处刷新。
// 4 按钮 + YNRD 快捷键：
//   Y → 确认（approve 整体）
//   N → 拒绝（reject 整体）
//   R → 重生（再发一条 "重新生成 …" 触发编排）
//   D → 联动主区 Diff（push 路由 query view=diff）
// pending 完成态显示 "✓ 已入 .git" / "✗ 已弃用"

export function PendingActions({ cid, count }: { cid: string; count: number }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { pid } = useParams<{ pid: string }>();
  const searchParams = useSearchParams();
  const sid = useSessionStore((s) => s.sid);
  const push = useSessionStore((s) => s.push);
  const mode = useHitlStore((s) => s.mode);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["artifact"] });
    qc.invalidateQueries({ queryKey: ["artifacts"] });
    qc.invalidateQueries({ queryKey: ["pending-changes"] });
    qc.invalidateQueries({ queryKey: ["rtm"] });
  };

  const approve = useMutation({
    mutationFn: () => api.approve(cid),
    onSuccess: refresh,
  });
  const reject = useMutation({
    mutationFn: () => api.reject(cid, "user rejected"),
    onSuccess: refresh,
  });

  const done = approve.isSuccess || reject.isSuccess;

  // D 联动主区 Diff：跳到 /p/{pid}/requirement/main?view=diff
  const goDiff = () => {
    if (!pid) return;
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("view", "diff");
    router.push(`/p/${pid}/requirement/main?${qs.toString()}`);
  };

  // R 重生：再发一条 "重新生成" 消息（具体类型由编排路由识别）
  const regen = async () => {
    if (!sid) return;
    const content = "重新生成";
    push({ id: `local-${Date.now()}`, role: "user", content });
    try {
      await api.send(sid, content, mode);
    } catch {
      /* 静默；SSE 推结果 */
    }
  };

  useEffect(() => {
    if (done) return;
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const k = e.key.toLowerCase();
      if (k === "y") approve.mutate();
      else if (k === "n") reject.mutate();
      else if (k === "r") regen();
      else if (k === "d") goDiff();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  if (done) {
    return (
      <div className="mt-1 rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs text-text-secondary">
        {approve.isSuccess ? "✓ 已确认 · 已入 .git" : "✗ 已弃用"}
      </div>
    );
  }

  return (
    <div className="mt-1 space-y-2 rounded-md border border-pending bg-warning-subtle p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-warning">
          🟡 待确认 · 剩余 {count > 0 ? count : "—"} 处
        </span>
        <span className="text-[11px] text-text-muted">快捷键 Y / N / R / D</span>
      </div>
      <div className="flex gap-1.5">
        <Button
          variant="success"
          size="sm"
          className="flex-1"
          onClick={() => approve.mutate()}
          disabled={approve.isPending}
          title="Y 确认"
        >
          <Check className={cn("h-3.5 w-3.5")} /> 确认修改{count > 0 ? `【${count}】` : ""}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => reject.mutate()}
          disabled={reject.isPending}
          title="N 拒绝"
        >
          <X className="h-3.5 w-3.5" /> 拒绝
        </Button>
        <Button variant="outline" size="sm" onClick={regen} title="R 重生">
          <RotateCw className="h-3.5 w-3.5" /> 重生
        </Button>
        <Button variant="outline" size="sm" onClick={goDiff} title="D Diff">
          <FileText className="h-3.5 w-3.5" /> diff
        </Button>
      </div>
    </div>
  );
}

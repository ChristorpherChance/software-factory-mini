"use client";

import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useHitlStore } from "@/stores/hitl";
import { cn } from "@/lib/utils";

// 定稿按钮（T-HITL-01）：三检全绿才能定稿；仅 HITL=Manual 允许强制定稿
export function FinalizeButton({
  pid,
  sid,
  allGreen,
}: {
  pid: string;
  sid: string;
  allGreen: boolean;
}) {
  const mode = useHitlStore((s) => s.mode);
  const canForce = mode === "Manual"; // 仅手动档允许强制
  const enabled = allGreen || canForce;
  const force = !allGreen && canForce;

  const fin = useMutation({
    mutationFn: () => api.finalize(pid, sid, force),
  });

  return (
    <button
      onClick={() => fin.mutate()}
      disabled={!enabled || fin.isPending}
      className={cn(
        "w-full rounded-md px-3 py-2 text-sm font-medium",
        enabled
          ? "bg-success text-white hover:opacity-90"
          : "cursor-not-allowed bg-bg-subtle text-text-muted"
      )}
    >
      {fin.isSuccess
        ? "✅ 已定稿"
        : fin.isPending
        ? "定稿中…"
        : allGreen
        ? "定稿需求三件套"
        : canForce
        ? "强制定稿（人工覆盖）"
        : "待自检全绿"}
    </button>
  );
}

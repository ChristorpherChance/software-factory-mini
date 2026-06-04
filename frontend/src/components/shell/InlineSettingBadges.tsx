"use client";

import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useHitlStore } from "@/stores/hitl";
import { useSettingStore } from "@/stores/setting";
import { CANON_LABEL, nextMode } from "@/lib/hitl";

// 内联设置徽章（T-SET-05）：HITL 档 · 模型 · 端点
// 点击 HITL 徽章循环切档，并写入本会话覆盖。
export function InlineSettingBadges({ pid, sid }: { pid: string; sid: string }) {
  const { mode, setMode } = useHitlStore();
  const { model, endpoint } = useSettingStore();

  const override = useMutation({
    mutationFn: (p: { category: string; key: string; value: any }) =>
      api.putOverride(pid, sid, p.category, p.key, p.value),
  });

  const cycle = () => {
    const next = nextMode(mode);
    setMode(next);
    // 本会话覆盖（后端不可达时静默失败，不影响本地档位）
    override.mutate({ category: "hitl", key: "mode", value: next });
  };

  const badge =
    "rounded-full bg-bg-subtle px-2 py-0.5 text-text-secondary";

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <button onClick={cycle} className={`${badge} hover:bg-border/40`}>
        HITL：{CANON_LABEL[mode]}
      </button>
      <span className={badge}>模型：{(model as any)?.name ?? "默认"}</span>
      <span className={badge}>端点：{(endpoint as any)?.name ?? "默认"}</span>
    </div>
  );
}

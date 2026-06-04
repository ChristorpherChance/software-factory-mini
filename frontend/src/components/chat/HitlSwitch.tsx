"use client";

import { useHitlStore } from "@/stores/hitl";
import { CANON_LABEL, HITL_MODES } from "@/lib/hitl";
import { cn } from "@/lib/utils";

// HITL 三档切换（T-HITL-02）
export function HitlSwitch() {
  const { mode, setMode } = useHitlStore();
  return (
    <div className="flex overflow-hidden rounded-md border border-border text-xs">
      {HITL_MODES.map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={cn(
            "px-2 py-0.5 transition-colors",
            mode === m
              ? "bg-text font-medium text-bg"
              : "text-text-secondary hover:bg-bg-subtle"
          )}
        >
          {CANON_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

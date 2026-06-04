// 软件工厂缩小版 · HITL 三档定义
// 规范值（canon）：Auto / Semi / Manual；前端档位标签为中文。

export type HitlMode = "Auto" | "Semi" | "Manual";

/** 前端简写 → 规范值（兼容旧映射）。 */
export const FE_TO_CANON = { auto: "Auto", assist: "Semi", manual: "Manual" } as const;

/** 规范值 → 中文标签。 */
export const CANON_LABEL: Record<HitlMode, string> = {
  Auto: "自动",
  Semi: "半自动",
  Manual: "手动",
};

/** 三档循环顺序：Auto → Semi → Manual → Auto。 */
export function nextMode(mode: HitlMode): HitlMode {
  return mode === "Auto" ? "Semi" : mode === "Semi" ? "Manual" : "Auto";
}

export const HITL_MODES: HitlMode[] = ["Auto", "Semi", "Manual"];

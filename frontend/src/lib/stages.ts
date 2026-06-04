// 软件工厂缩小版 · 13 阶段主路径定义
// 数据三档：material/requirement 状态接 useStageStore (A 档)，其余 11 阶段静态 (C 档)
// 路由 key 与现有 Next.js 路由保持一致：material/requirement 可点，其余仅展示

export type StageStatus =
  | "not_started" // ○
  | "in_progress" // ◐
  | "finalized" // ✓
  | "failed" // ✗
  | "paused" // ⏸
  | "looping"; // 🔁

export interface Stage {
  /** 路由 key（与 /p/[pid]/[stage]/[section] 对齐）；不可点阶段用 stub key */
  key: string;
  /** 1-13 序号 */
  index: number;
  /** 中文名 */
  name: string;
  /** emoji 图标 */
  icon: string;
  /** 阶段状态（C 档为 not_started） */
  status: StageStatus;
  /** 0-100 */
  progress: number;
  /** 本期是否可路由 */
  available: boolean;
}

export const STAGES: Stage[] = [
  { key: "material",    index: 1,  name: "资料", icon: "📥", status: "in_progress",  progress: 60,  available: true  },
  { key: "requirement", index: 2,  name: "需求", icon: "📝", status: "not_started",  progress: 0,   available: true  },
  { key: "design",      index: 3,  name: "设计", icon: "🎨", status: "not_started",  progress: 0,   available: false },
  { key: "develop",     index: 4,  name: "开发", icon: "💻", status: "not_started",  progress: 0,   available: false },
  { key: "review",      index: 5,  name: "审查", icon: "🧐", status: "not_started",  progress: 0,   available: false },
  { key: "unit-test",   index: 6,  name: "单测", icon: "🧪", status: "not_started",  progress: 0,   available: false },
  { key: "integration", index: 7,  name: "集测", icon: "🔗", status: "not_started",  progress: 0,   available: false },
  { key: "deploy",      index: 8,  name: "部署", icon: "🚀", status: "not_started",  progress: 0,   available: false },
  { key: "system-test", index: 9,  name: "系测", icon: "🖥",  status: "not_started",  progress: 0,   available: false },
  { key: "converge",    index: 10, name: "收敛", icon: "🎯", status: "not_started",  progress: 0,   available: false },
  { key: "release",     index: 11, name: "发布", icon: "📦", status: "not_started",  progress: 0,   available: false },
  { key: "operate",     index: 12, name: "运维", icon: "🛠",  status: "not_started",  progress: 0,   available: false },
  { key: "feedback",    index: 13, name: "反馈", icon: "💬", status: "not_started",  progress: 0,   available: false },
];

export const STATUS_GLYPH: Record<StageStatus, string> = {
  not_started: "○",
  in_progress: "◐",
  finalized:   "✓",
  failed:      "✗",
  paused:      "⏸",
  looping:     "🔁",
};

export const STATUS_COLOR: Record<StageStatus, string> = {
  not_started: "text-text-muted",
  in_progress: "text-primary",
  finalized:   "text-success",
  failed:      "text-error",
  paused:      "text-warning",
  looping:     "text-info",
};

/** 按 stage key 查阶段定义；未知 key 返回 null。 */
export function findStage(key: string): Stage | null {
  return STAGES.find((s) => s.key === key) ?? null;
}

/** stageStore 三态(todo/doing/done/fail) 映射到 StageStatus。 */
export function mapDotToStatus(dot: string | undefined): StageStatus {
  switch (dot) {
    case "doing": return "in_progress";
    case "done":  return "finalized";
    case "fail":  return "failed";
    default:      return "not_started";
  }
}

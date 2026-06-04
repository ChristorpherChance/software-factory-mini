import { Lock } from "lucide-react";

// 未开放阶段统一占位（照搬原型 PlaceholderStage）：Lock 圆 + 标题 + 说明
export function PlaceholderStage({ name }: { name: string }) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-bg text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-subtle">
        <Lock className="h-6 w-6 text-text-muted" />
      </div>
      <div className="text-lg font-semibold text-text">{name} · 本期未实现</div>
      <p className="max-w-sm text-sm text-text-muted">
        本期仅实现「资料」与「需求」两个阶段。该阶段为完整产品导航占位，敬请期待。
      </p>
    </div>
  );
}

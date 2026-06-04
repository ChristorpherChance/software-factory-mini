"use client";

import { useParams } from "next/navigation";
import { MaterialView } from "@/components/main/MaterialView";
import { RequirementView } from "@/components/main/RequirementView";
import { PlaceholderStage } from "@/components/main/PlaceholderStage";
import { findStage } from "@/lib/stages";

// 主区路由：material → 资料视图，requirement → 需求视图，其余 11 阶段统一 PlaceholderStage
export default function SectionPage() {
  const { stage } = useParams<{ stage: string; section: string }>();
  if (stage === "material") return <MaterialView />;
  if (stage === "requirement") return <RequirementView />;
  const def = findStage(stage);
  return <PlaceholderStage name={def?.name ?? `阶段 ${stage}`} />;
}

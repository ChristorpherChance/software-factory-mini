"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ArtifactDto } from "@/lib/api";
import { DiffView } from "./DiffView";

export function ArtifactRenderer({ artifact }: { artifact: ArtifactDto | null }) {
  const [showDiff, setShowDiff] = useState(false);
  if (!artifact) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-muted">
        暂无工件，点击「生成」让编排 Agent 产出。
      </div>
    );
  }

  const ver = artifact.currentVersion ?? artifact.version ?? 1;
  const canDiff = ver > 1;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-text">
          {artifact.title}
          <span className="ml-2 text-xs text-text-muted">v{ver}</span>
          {artifact.status && (
            <span className="ml-2 rounded-full bg-bg-subtle px-2 py-0.5 text-xs text-text-secondary">
              {artifact.status}
            </span>
          )}
        </h3>
        {canDiff && (
          <button
            onClick={() => setShowDiff((v) => !v)}
            className="text-xs text-primary hover:underline"
          >
            {showDiff ? "隐藏" : "对比"}上一版
          </button>
        )}
      </div>

      {showDiff && canDiff ? (
        <DiffView aid={artifact.id} from={ver - 1} to={ver} />
      ) : (
        <article className="prose prose-sm max-w-none text-text">
          <ReactMarkdown>{artifact.content ?? ""}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}

// afterToolCall 审计：回调后端写 DelegateAudit（Phase 4 接 internal/audit；Phase 0 安全降级）。
import { createHash } from "node:crypto";
import { callBackend } from "../backend.js";

export async function postAudit(a: { session: string; tool: string; input: unknown }): Promise<void> {
  const payload = {
    session_id: a.session,
    target: a.tool,
    payload_sha256: createHash("sha256").update(JSON.stringify(a.input ?? null)).digest("hex"),
    ts: Date.now(),
  };
  // Phase 0/1：后端 internal/audit 端点尚未就绪，失败静默（不阻塞 Agent）。
  await callBackend("/api/v1/internal/audit", payload).catch(() => {});
}

// 能力进化双环（Phase 3.5）：skill_propose（不写盘）/ skill_apply（受保护路径唯一写入口）。
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { callBackend } from "../backend.js";
import { textResult } from "./helpers.js";

const PROJECT = join(process.cwd(), "project");

const ProposeParams = Type.Object({
  name: Type.String(),
  kind: Type.Union([Type.Literal("skill"), Type.Literal("prompt"), Type.Literal("agent_md")]),
  draft: Type.String({ description: "能力草案完整内容" }),
  rationale: Type.String({ description: "为什么需要这个能力" }),
  eval_cases: Type.Optional(Type.Array(Type.String())),
  project_id: Type.Optional(Type.String()),
});

export const skillProposeTool: AgentTool<typeof ProposeParams> = {
  name: "skill_propose",
  label: "提案能力",
  description: "提出 Skill/Prompt/AGENTS.md 草案 → 落 PendingChange，绝不写盘（走审批）",
  parameters: ProposeParams,
  execute: async (_id, params: Static<typeof ProposeParams>) => {
    const r = await callBackend<{ version_id: string; pending_change_id: string }>(
      "/api/v1/internal/capability/propose",
      params,
    );
    return textResult(
      `已提案能力「${params.name}」，待审批（pending=${r.pending_change_id}）`,
      r,
    );
  },
};

const ApplyParams = Type.Object({
  version_id: Type.String(),
});

export const skillApplyTool: AgentTool<typeof ApplyParams> = {
  name: "skill_apply",
  label: "应用能力",
  description: "把已审批且过评测的能力版本写入 .pi/ 并生效（受保护路径唯一写入口）",
  parameters: ApplyParams,
  execute: async (_id, params: Static<typeof ApplyParams>) => {
    // 后端校验：已审批 + 回归评测 ≥ 0.85，否则抛 409/422
    const v = await callBackend<{ kind: string; name: string; content: string; version_id: string }>(
      "/api/v1/internal/capability/apply",
      { version_id: params.version_id },
    );
    // 唯一绕过 pathGuard 的写盘点（execute 内直写，不经内核 write 工具）
    const dir = v.kind === "prompt" ? ".pi/prompts" : ".pi/skills";
    const file = join(PROJECT, dir, `${v.name}.md`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `# version: ${v.version_id}\n${v.content}`, "utf8");
    // reload：重建会话使新能力生效（通过全局 manager，见 server 注入）
    if (globalThis.__sfReload) globalThis.__sfReload();
    return textResult(`能力「${v.name}」已应用并生效（${dir}/${v.name}.md）`, { applied: true });
  },
};

declare global {
  // eslint-disable-next-line no-var
  var __sfReload: (() => void) | undefined;
}

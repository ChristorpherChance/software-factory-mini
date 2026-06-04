// write 工具：写文件到 project 工作区。
// 受 beforeToolCall.pathGuard 约束（铁律#5：.pi/skills、.pi/prompts、project/*.md、src/、
// agent-service/ 受保护，被 block，唯一写入口是 skill_apply）。
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { textResult } from "./helpers.js";

const WORKDIR = join(process.cwd(), "project");

const Params = Type.Object({
  path: Type.String({ description: "相对 project/ 的文件路径，如 notes/draft.md" }),
  content: Type.String(),
});

export const fileWriteTool: AgentTool<typeof Params> = {
  name: "write",
  label: "写文件",
  description: "写文本文件到 project 工作区（受保护路径会被拒绝，请改用 skill_propose）",
  parameters: Params,
  execute: async (_id, params: Static<typeof Params>) => {
    // 双保险：execute 内再校验目标不逃逸出 WORKDIR
    const abs = resolve(WORKDIR, params.path);
    if (!abs.startsWith(WORKDIR)) {
      throw new Error("path escapes project workdir");
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, params.content, "utf8");
    return textResult(`已写入 ${params.path}（${params.content.length} 字节）`, { path: params.path });
  },
};

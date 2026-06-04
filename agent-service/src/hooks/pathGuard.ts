// 受保护路径 denylist（同步、零 IO）。铁律#5：自进化能力不得绕过闸门写保护路径。
import { normalize } from "node:path";

const PROTECTED = [
  /^\.pi\/skills\//,
  /^\.pi\/prompts\//,
  /^project\/AGENTS\.md$/,
  /^project\/SYSTEM\.md$/,
  /^src\//,
  /^agent-service\//,
];

export function pathGuard(call: { name: string; input: any }): { block?: boolean; reason?: string } {
  if (["write", "edit"].includes(call.name)) {
    const p = normalize(String(call.input?.path ?? "")).replace(/^\.\//, "").replace(/\\/g, "/");
    if (PROTECTED.some((re) => re.test(p))) {
      return { block: true, reason: "受保护路径，请改用 skill_propose" };
    }
  }
  if (
    call.name === "bash" &&
    /(\.pi\/(skills|prompts)|git\s+push|npm\s+i|pip\s+install)/.test(String(call.input?.cmd ?? ""))
  ) {
    return { block: true, reason: "bash 触及保护路径/写操作，需 HITL" };
  }
  return {};
}

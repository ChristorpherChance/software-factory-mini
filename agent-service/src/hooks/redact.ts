// 脱敏：手机号/邮箱/Key/Token → [REDACTED-{type}-{hash8}]（纯函数）。
import { createHash } from "node:crypto";

const PATTERNS: Array<[string, RegExp]> = [
  ["EMAIL", /[\w.+-]+@[\w-]+\.[\w.-]+/g],
  ["PHONE", /\b1[3-9]\d{9}\b/g],
  ["KEY", /\b(sk|pk|ghp|xox[bap])[-_][A-Za-z0-9]{16,}\b/g],
  ["TOKEN", /\bBearer\s+[A-Za-z0-9._-]{16,}\b/g],
];

export function redact<T>(input: T): T {
  let s = JSON.stringify(input);
  if (s === undefined) return input;
  for (const [type, re] of PATTERNS) {
    s = s.replace(re, (m) => `[REDACTED-${type}-${createHash("sha256").update(m).digest("hex").slice(0, 8)}]`);
  }
  return JSON.parse(s) as T;
}

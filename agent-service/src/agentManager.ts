// 按 sessionId 持有多个 AgentSession（in-process 多会话宿主）。
import { randomUUID } from "node:crypto";
import { AgentSession, buildAgent } from "./agent.js";

export class AgentManager {
  private sessions = new Map<string, AgentSession>();

  /** 确保会话存在，返回其 id。 */
  ensure(sessionId?: string): string {
    const id = sessionId ?? randomUUID();
    if (!this.sessions.has(id)) this.sessions.set(id, buildAgent(id));
    return id;
  }

  ensureSession(sessionId?: string): AgentSession {
    return this.sessions.get(this.ensure(sessionId))!;
  }

  /** 重建会话（Phase 3.5 skill_apply 后 /reload 用）。 */
  reload(sessionId: string): void {
    this.sessions.set(sessionId, buildAgent(sessionId));
  }

  async runStructure(
    text: string,
    sessionId?: string,
    promptOverride?: string,
  ): Promise<Record<string, unknown>> {
    return this.ensureSession(this.ensure(sessionId)).runStructure(text, promptOverride);
  }
  async runRequirement(
    kind: string,
    upstream: string,
    sessionId?: string,
    promptOverride?: string,
  ): Promise<string> {
    return this.ensureSession(this.ensure(sessionId)).runRequirement(
      kind,
      upstream,
      promptOverride,
    );
  }
  postMessage(id: string, content: string): void {
    this.ensureSession(id).post(content);
  }
  async runBeautify(draft: string, sessionId?: string): Promise<string> {
    return this.ensureSession(this.ensure(sessionId)).runBeautify(draft);
  }
  resolveHitl(id: string, decision: { reqId: string; decision: "allow" | "rewrite" | "deny" }): void {
    this.ensureSession(id).resolveHitl(decision);
  }
  async interrupt(id: string): Promise<void> {
    await this.ensureSession(id).interrupt();
  }
}

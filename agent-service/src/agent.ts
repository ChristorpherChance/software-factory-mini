// AgentSession：单会话宿主，封装 pi-agent-core 的 Agent。
// 按 pi-agent-core@0.78 真实 API：
//   - new Agent({ initialState:{systemPrompt,model,tools,thinkingLevel}, convertToLlm, streamFn, getApiKey, ... })
//   - agent.prompt(string) -> Promise<void>（结果靠事件）
//   - agent.subscribe((event, signal) => ...)；事件 message_update/message_end/tool_execution_start/agent_end
//   - agent.abort()
import { Agent, convertToLlm } from "@earendil-works/pi-agent-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ensureProviders, buildModel, streamFn, getApiKey } from "./model.js";
import { allTools } from "./tools/index.js";
import { pathGuard } from "./hooks/pathGuard.js";
import { redact } from "./hooks/redact.js";
import { postAudit } from "./hooks/audit.js";
import { customCompaction } from "./hooks/compaction.js";

const PROJECT = join(process.cwd(), "project");
function readProject(p: string): string {
  try {
    return readFileSync(join(PROJECT, p), "utf8");
  } catch {
    return "";
  }
}

/** WS 事件（对齐前端/后端 7 事件语义子集）。 */
export type WsEvent =
  | { type: "message.delta"; text: string }
  | { type: "message.end" }
  | { type: "tool.call"; tool: string; status?: string }
  | { type: "hitl.request"; reqId: string; tool: string; input: unknown }
  | { type: "stage.gate"; [k: string]: unknown };

type Listener = (event: WsEvent) => void;

/** 敏感工具：按 HITL 档位需要人工确认（Phase 4 启用拦截，Phase 0 仅占位）。 */
const SENSITIVE = new Set([
  "bash",
  "write",
  "edit",
  "delegate",
  "skill_propose",
  "skill_apply",
]);

export class AgentSession {
  private agent: Agent;
  private listeners = new Set<Listener>();
  private hitl = new Map<string, (allow: boolean) => void>();
  /** 会话 HITL 档：Auto|Semi|Manual（由后端通过消息透传，默认 Semi）。 */
  hitlMode: "Auto" | "Semi" | "Manual" = "Semi";
  /** 最近一次 prompt 结束时聚合的助手文本（runRequirement 用）。 */
  private lastText = "";
  /** 工具发出的结构化结果（runStructure 用，Phase 3 由 emit 工具回填）。 */
  private lastStructured: Record<string, unknown> | null = null;

  constructor(public id: string) {
    ensureProviders();
    this.agent = new Agent({
      initialState: {
        systemPrompt: readProject("SYSTEM.md") || "你是软件工厂的需求工程 Agent。",
        model: buildModel(),
        thinkingLevel: "off", // D4：确定性，关思考
        tools: allTools,
      },
      sessionId: id,
      convertToLlm, // 复用 harness 现成实现
      streamFn,
      getApiKey: () => getApiKey(),
      toolExecution: "sequential",
      transformContext: customCompaction,
      beforeToolCall: async (ctx) => {
        const call = { name: ctx.toolCall.name, input: ctx.args };
        // 铁律#5：受保护路径 denylist
        const guard = pathGuard(call);
        if (guard.block) return guard;
        // 脱敏：命中即替换（不改变工具行为，仅用于审计/HITL 预览）
        // 真实入参替换在 Phase 4 完善；此处先做 HITL 拦截。
        if (this.hitlMode !== "Auto" && SENSITIVE.has(call.name)) {
          const allow = await this.requestHitl(call.name, redact(call.input));
          if (!allow) return { block: true, reason: "HITL denied" };
        }
        return undefined; // 放行
      },
      afterToolCall: async (ctx) => {
        await postAudit({
          session: this.id,
          tool: ctx.toolCall.name,
          input: ctx.args,
        }).catch(() => {});
        return undefined;
      },
    });

    // 内核事件 → WS 事件流
    this.agent.subscribe((ev) => {
      switch (ev.type) {
        case "message_update": {
          // 从 assistantMessageEvent 提取文本增量
          const delta = extractDelta(ev.assistantMessageEvent);
          if (delta) {
            this.lastText += delta;
            this.emit({ type: "message.delta", text: delta });
          }
          break;
        }
        case "message_end":
          this.emit({ type: "message.end" });
          break;
        case "tool_execution_start":
          this.emit({ type: "tool.call", tool: ev.toolName, status: "running" });
          break;
        case "tool_execution_end":
          this.emit({ type: "tool.call", tool: ev.toolName, status: ev.isError ? "error" : "ok" });
          break;
        default:
          break;
      }
    });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(ev: WsEvent): void {
    for (const l of this.listeners) l(ev);
  }

  private requestHitl(tool: string, input: unknown): Promise<boolean> {
    const reqId = randomUUID();
    this.emit({ type: "hitl.request", reqId, tool, input });
    return new Promise((res) => this.hitl.set(reqId, res));
  }
  resolveHitl(d: { reqId: string; decision: "allow" | "rewrite" | "deny" }): void {
    const r = this.hitl.get(d.reqId);
    if (r) {
      r(d.decision === "allow" || d.decision === "rewrite");
      this.hitl.delete(d.reqId);
    }
  }

  /** 跑完后若 Agent 处于错误态，抛出（让 server 返回非 2xx → Python 侧回落 stub，铁律#3）。 */
  private assertNoError(): void {
    const errMsg = this.agent.state.errorMessage;
    if (errMsg) throw new Error(`agent error: ${errMsg}`);
  }

  /** 资料结构化：跑一轮，返回结构化 JSON（Phase 3 由 emit 工具回填 lastStructured）。 */
  async runStructure(text: string): Promise<Record<string, unknown>> {
    this.lastText = "";
    this.lastStructured = null;
    await this.agent.prompt(`/structure\n${text}`);
    await this.agent.waitForIdle();
    this.assertNoError();
    // 无结构化输出且无文本视为失败（避免空结果伪装成功）
    if (!this.lastStructured && !this.lastText.trim()) {
      throw new Error("agent produced empty structure");
    }
    return this.lastStructured ?? { _raw: this.lastText };
  }

  /** 需求生成：跑一轮，返回 markdown 文本。 */
  async runRequirement(kind: string, upstream: string): Promise<string> {
    this.lastText = "";
    await this.agent.prompt(`/${kind}\n${upstream}`);
    await this.agent.waitForIdle();
    this.assertNoError();
    if (!this.lastText.trim()) throw new Error("agent produced empty requirement");
    return this.lastText;
  }

  /** 普通消息（WS 路径用，不等待，事件实时推）。 */
  post(content: string): void {
    void this.agent.prompt(content);
  }

  setStructured(s: Record<string, unknown>): void {
    this.lastStructured = s;
  }

  async interrupt(): Promise<void> {
    this.agent.abort();
  }
}

/** 从 pi-ai 的 AssistantMessageEvent 中提取文本增量。 */
function extractDelta(ev: unknown): string {
  if (!ev || typeof ev !== "object") return "";
  const e = ev as Record<string, any>;
  // pi-ai 事件形态：{type:"update", delta:{...}} 或 partial 文本块
  // 尽量宽容地提取文本，未知形态返回空串（不抛错）。
  if (typeof e.text === "string") return e.text;
  if (e.delta && typeof e.delta === "object") {
    if (typeof e.delta.text === "string") return e.delta.text;
    if (typeof e.delta.content === "string") return e.delta.content;
  }
  if (typeof e.content === "string") return e.content;
  return "";
}

export function buildAgent(id: string): AgentSession {
  return new AgentSession(id);
}

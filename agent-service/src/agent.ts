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

/** 命令 → prompt 模板展开（/ord /crd /prd 读 .pi/prompts/<kind>.md 拼上游输入）。 */
const PROMPT_KINDS = new Set(["ord", "crd", "prd", "selfcheck", "structure"]);
function expandCommand(content: string): string {
  const m = content.match(/^\/(\w+)\s*([\s\S]*)$/);
  if (!m) return content;
  const kind = m[1].toLowerCase();
  const rest = m[2] ?? "";
  if (!PROMPT_KINDS.has(kind)) return content;
  const tpl = readProject(`.pi/prompts/${kind}.md`);
  if (!tpl) return content; // 无模板则原样（structure 等 Phase 5 再补）
  return `${tpl}\n${rest}`;
}

/** 最小格式约束：附在用户自定义提示词末尾，保证后端 RTM 正则可解析（编号 + 「（上溯：…）」）。
 *  仅含格式约束、不含内容指令，不喧宾夺主。 */
const FORMAT_HINT =
  "\n\n---\n[输出格式约束]\n" +
  "需求项请用 Markdown 列表，每条带编号（CRD 用 CR-001、PRD 用 PRD-F-001/PRD-NFR-001）；" +
  "下游条目以「（上溯：<上游编号 或 资料>）」标注来源；用 #/## 分节。仅输出文档正文。";

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
  /** 系统默认 systemPrompt（设置页未配置时回落）。 */
  private defaultSystemPrompt: string;
  /** postGenerate 用：整轮结束（agent_end）时一次性恢复 tools/systemPrompt。 */
  private pendingRestore: (() => void) | null = null;

  constructor(public id: string) {
    ensureProviders();
    this.defaultSystemPrompt = readProject("SYSTEM.md") || "你是软件工厂的需求工程 Agent。";
    this.agent = new Agent({
      initialState: {
        systemPrompt: this.defaultSystemPrompt,
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
          // 从 assistantMessageEvent 提取文本增量（仅 text_delta，排除 thinking）
          const delta = extractDelta(ev.assistantMessageEvent);
          if (delta) {
            this.lastText += delta;
            this.emit({ type: "message.delta", text: delta });
          }
          break;
        }
        case "agent_end":
          // 整轮结束才发 WS message.end（内核可能跑多个 message_end 子轮，不可逐个转发）
          this.emit({ type: "message.end" });
          // postGenerate 临时覆写的 tools/systemPrompt 在整轮结束后恢复
          if (this.pendingRestore) {
            const r = this.pendingRestore;
            this.pendingRestore = null;
            r();
          }
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

  /** 资料结构化：纯文本任务，临时清空工具（Phase 5 接 tooling 后再调整）。
   *  promptOverride：设置页配置的「当前 Prompt」，临时覆写 systemPrompt（finally 恢复）。 */
  async runStructure(
    text: string,
    promptOverride?: string,
  ): Promise<Record<string, unknown>> {
    this.lastText = "";
    this.lastStructured = null;
    const savedTools = this.agent.state.tools;
    const savedSys = this.agent.state.systemPrompt;
    this.agent.state.tools = [];
    if (promptOverride && promptOverride.trim()) this.agent.state.systemPrompt = promptOverride;
    try {
      await this.agent.prompt(`/structure\n${text}`);
      await this.agent.waitForIdle();
      this.assertNoError();
      if (!this.lastStructured && !this.lastText.trim()) {
        throw new Error("agent produced empty structure");
      }
      return this.lastStructured ?? { _raw: this.lastText };
    } finally {
      this.agent.state.tools = savedTools;
      this.agent.state.systemPrompt = savedSys;
    }
  }

  /** 需求生成：纯文本输出任务，临时清空工具（避免 thinking 模型陷入工具循环/terminate）。
   *  promptOverride：设置页配置的「当前 Prompt」，临时覆写 systemPrompt（finally 恢复）。 */
  async runRequirement(
    kind: string,
    upstream: string,
    promptOverride?: string,
  ): Promise<string> {
    this.lastText = "";
    const savedTools = this.agent.state.tools;
    const savedSys = this.agent.state.systemPrompt;
    this.agent.state.tools = [];
    if (promptOverride && promptOverride.trim()) this.agent.state.systemPrompt = promptOverride;
    try {
      await this.agent.prompt(expandCommand(`/${kind}\n${upstream}`));
      await this.agent.waitForIdle();
      this.assertNoError();
      if (!this.lastText.trim()) throw new Error("agent produced empty requirement");
      return this.lastText;
    } finally {
      this.agent.state.tools = savedTools;
      this.agent.state.systemPrompt = savedSys;
    }
  }

  /** 普通消息（WS 路径用，不等待，事件实时推）。命令自动展开模板。 */
  post(content: string): void {
    void this.agent.prompt(expandCommand(content));
  }

  /** 文档生成（WS 真流式）：临时清空工具 + 覆写 systemPrompt（用户配置的 Agent），
   *  发 `/<kind>\n<upstream>` 让 DeepSeek 逐 token 出文；整轮结束（agent_end）后恢复。
   *  清空工具沿用 runRequirement 经验，避免 thinking 模型陷入工具循环/terminate。
   *
   *  问题1 修复：当传入 systemPrompt（用户在设置页配置的 Agent 提示词）时，**以用户提示词为主**——
   *  不再用 expandCommand 把 .pi/prompts 骨架拼进 user message（那会盖过 systemPrompt）；
   *  仅在 systemPrompt 末尾附一行最小格式约束，保证 RTM 正则可解析（编号 + 「（上溯：…）」）。
   *  无 systemPrompt 时回落骨架模板（保留 stub/默认行为）。 */
  postGenerate(kind: string, upstream: string, systemPrompt?: string): void {
    this.beginOverride(systemPrompt, true);
    if (systemPrompt && systemPrompt.trim()) {
      // 用户提示词为主：直接把上游输入作为 user message，systemPrompt 已含全部指令。
      void this.agent.prompt(upstream);
    } else {
      void this.agent.prompt(expandCommand(`/${kind}\n${upstream}`));
    }
  }

  /** 定向编辑（问题2）：systemPrompt = 编辑器人设(+用户配置)，user message = 当前完整文档 + 修改指令。
   *  输出完整修改后文档（后端用 difflib 切块、按块确认后写回）。 */
  postEdit(currentDoc: string, instruction: string, systemPrompt?: string): void {
    const editorPersona =
      "你是需求文档编辑器。下面给出【当前完整文档】与【修改指令】。" +
      "请只按指令修改对应条目，保持其它所有内容逐字不变，输出**完整的修改后文档**（Markdown，含未改动部分）。" +
      "不要解释、不要只输出片段。保留原有编号与「（上溯：…）」标注样式。";
    const sys =
      systemPrompt && systemPrompt.trim()
        ? `${editorPersona}\n\n（领域提示词）\n${systemPrompt}`
        : editorPersona;
    this.beginOverride(sys, true);
    void this.agent.prompt(`【当前完整文档】\n${currentDoc}\n\n【修改指令】\n${instruction}`);
  }

  /** 美化（问题1）：把用户粘贴的草稿提示词整理为结构清晰、可直接用于生成的规范提示词。 */
  postBeautify(draft: string): void {
    const sys =
      "你是提示词工程师。把用户给出的草稿整理为结构清晰、表述规范的【系统提示词】，" +
      "用于指导需求文档生成 Agent。保留草稿的全部意图与约束，补全结构（角色/职责/输出格式/约束），" +
      "但不要臆造与草稿无关的新规则。只输出整理后的提示词正文，不要解释。";
    this.beginOverride(sys, false); // 美化输出是提示词本身，不附需求格式约束
    void this.agent.prompt(draft);
  }

  /** 临时清空工具 + 覆写 systemPrompt，记录 agent_end 后的恢复闭包（postGenerate/Edit/Beautify 共用）。
   *  withFormatHint：是否在 systemPrompt 末尾附最小格式约束（需求生成/编辑用，美化不用）。 */
  private beginOverride(systemPrompt?: string, withFormatHint = false): void {
    const savedTools = this.agent.state.tools;
    const savedSys = this.agent.state.systemPrompt;
    this.agent.state.tools = [];
    if (systemPrompt && systemPrompt.trim()) {
      this.agent.state.systemPrompt = systemPrompt + (withFormatHint ? FORMAT_HINT : "");
    }
    this.pendingRestore = () => {
      this.agent.state.tools = savedTools;
      this.agent.state.systemPrompt = savedSys;
    };
  }

  /** 美化（同步，HTTP 路径）：等待完整结果返回整理后的提示词。 */
  async runBeautify(draft: string): Promise<string> {
    this.lastText = "";
    const savedTools = this.agent.state.tools;
    const savedSys = this.agent.state.systemPrompt;
    this.agent.state.tools = [];
    this.agent.state.systemPrompt =
      "你是提示词工程师。把用户给出的草稿整理为结构清晰、表述规范的【系统提示词】，" +
      "用于指导需求文档生成 Agent。保留草稿的全部意图与约束，补全结构（角色/职责/输出格式/约束），" +
      "但不要臆造与草稿无关的新规则。只输出整理后的提示词正文，不要解释。";
    try {
      await this.agent.prompt(draft);
      await this.agent.waitForIdle();
      this.assertNoError();
      if (!this.lastText.trim()) throw new Error("agent produced empty beautify result");
      return this.lastText;
    } finally {
      this.agent.state.tools = savedTools;
      this.agent.state.systemPrompt = savedSys;
    }
  }

  setStructured(s: Record<string, unknown>): void {
    this.lastStructured = s;
  }

  async interrupt(): Promise<void> {
    this.agent.abort();
  }
}

/** 从 pi-ai 的 AssistantMessageEvent 中提取文本增量。
 *  实测事件形态：{type:"text_delta", delta:string, contentIndex, partial}。
 *  只取 text_delta（不含 thinking_delta/toolcall_delta，避免把思考/工具入参当正文）。 */
function extractDelta(ev: unknown): string {
  if (!ev || typeof ev !== "object") return "";
  const e = ev as Record<string, any>;
  if (e.type === "text_delta" && typeof e.delta === "string") return e.delta;
  return "";
}

export function buildAgent(id: string): AgentSession {
  return new AgentSession(id);
}

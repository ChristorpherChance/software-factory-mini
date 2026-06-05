// 软件工厂缩小版 · 前端 API 客户端
// 契约：base = /api/v1，鉴权头 Authorization: Bearer <token>
// 响应包裹：成功 {data, meta}；列表 {data, page, meta}；错误 {error:{code,message}}（HTTP 非 2xx）
// req() 统一取 body.data。

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api/v1";
const TOKEN = process.env.NEXT_PUBLIC_TOKEN ?? "dev-single-workspace-token";

/** 暴露 base，供 SSE EventSource 直接拼地址使用。 */
export const API_BASE = BASE;

/**
 * SSE 专用基址：必须绕过 Next.js dev 的 rewrites 代理，因其会缓冲
 * text/event-stream，导致 EventSource 收不到实时事件（流式输出/生成内容看不到）。
 * 默认直连后端 8000；可用 NEXT_PUBLIC_SSE_BASE 覆盖（生产同源时设为 /api/v1）。
 */
export const SSE_BASE =
  process.env.NEXT_PUBLIC_SSE_BASE ?? "http://localhost:8000/api/v1";

/** 统一请求：注入鉴权头与 JSON 头，非 2xx 抛错并带回 body。 */
async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  // 某些端点可能返回空体（如 204），容错解析
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.code ?? `HTTP_${res.status}`), {
      body,
      status: res.status,
    });
  }
  return body.data as T;
}

/** 生成幂等键（浏览器原生 crypto，SSR 下回退到时间戳）。 */
function idemKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** multipart 上传：不能用 req()（其强制 JSON 头），单独处理。 */
async function uploadReq<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` }, // 不设 Content-Type，让浏览器带 boundary
    body: form,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.code ?? `HTTP_${res.status}`), {
      body,
      status: res.status,
    });
  }
  return body.data as T;
}

// ===== 领域类型（camelCase，与后端契约对齐） =====

export interface Project {
  id: string;
  name: string;
  description?: string;
  currentStage?: string;
  hitlMode?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionDto {
  id: string;
  projectId: string;
  parentSessionId?: string | null;
  title?: string;
  stage?: string;
  agent?: string;
  hitlMode?: string;
  status?: string;
}

export interface MessageDto {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  status?: string;
  createdAt?: string;
}

export interface MaterialDto {
  id: string;
  type?: string;
  title: string;
  status?: string; // draft | finalized（20260603：文件解析定稿态）
  /** 是否已完成「内容解析」（transform）。后端 transform 成功时置 true；旧数据为 undefined。 */
  contentParsed?: boolean;
  /** 解析抽取出的文档正文（供主内容区渲染 + 编辑）。 */
  rawText?: string;
  readinessScore: number;
  summary?: string;
  keyPoints?: string[];
  quotes?: Array<{ text: string; anchor?: { page?: number; line?: number } }>;
  missingItems?: string[];
  tags?: string[];
  readinessDimensions?: Record<string, number>;
}

/** 上传文件（临时存储，待解析）。 */
export interface UploadedFileDto {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  status: string; // uploaded | parsing | parsed | finalized
  parsedArtifactId?: string | null;
  createdAt?: string;
}

/** 内容解析（翻译/索引/脱敏/增强）结果。 */
export interface TransformResultDto {
  version: number;
  content: string;
}

export interface ArtifactDto {
  id: string;
  type: string;
  title: string;
  stage?: string;
  status?: string;
  currentVersion?: number;
  version?: number;
  content: string;
  createdAt?: string;
}

export interface DiffDto {
  from: number;
  to: number;
  format: string;
  lines: string[];
}

export interface TaskDto {
  id: string;
  code: string;
  title: string;
  status: string;
  assignee?: string;
  estimate?: number;
  version: number;
}

export interface DiffBlockDto {
  id: string;
  kind: "add" | "del" | "mod";
  tag: string;
  lines: string[];
  state: "pending" | "confirmed" | "rejected";
}

export interface PendingChangeDto {
  id: string;
  targetType: string;
  targetId?: string | null;
  op: string;
  diff: any;
  /** M4 P1-A：切块 diff（编排生成时填入；按块 resolve 端点维护）。 */
  diffBlocks?: DiffBlockDto[] | null;
  sourceActor?: string;
  status: string;
}

export interface RtmReport {
  L0a: number;
  L0b: number;
  L0c: number;
  byLayer?: Record<string, number>;
  orphans: string[];
  healthScore: number;
  overall?: number;
}

export interface RtmNodeDto {
  id: string;
  code: string;
  layer: string;
  title?: string | null;
}

export interface RtmEdgeDto {
  from: string;
  to: string;
  relation: string;
}

export interface RtmFullDto {
  nodes: RtmNodeDto[];
  edges: RtmEdgeDto[];
  report: RtmReport;
}

export interface NotificationDto {
  id: string;
  projectId: string;
  group: "task" | "stage" | "artifact" | "crosscut" | "system";
  severity: "info" | "success" | "warning" | "error";
  title: string;
  summary?: string | null;
  source?: string | null;
  read: boolean;
  createdAt?: string;
}

export interface SelfCheckResult {
  artifactId: string;
  allGreen: boolean;
  checks: Array<{
    name: string;
    pass: boolean;
    coverage?: number;
    missing?: string[];
    orphans?: string[];
  }>;
}

export interface DelegateAuditDto {
  id: string;
  target: string;
  status: string;
  latencyMs?: number;
  createdAt?: string;
}

export interface EndpointDto {
  id: string;
  kind: string;
  name: string;
  baseUrl?: string;
  model?: string;
  hasKey: boolean;
  enabled: boolean;
  /** 供应商标识（OpenAI/DeepSeek/…）；后端来自 extra.provider，可能为 null。 */
  provider?: string;
}

export interface SettingAuditDto {
  id: string;
  category: string;
  key: string;
  oldValue?: any;
  newValue?: any;
  actor?: string;
  createdAt?: string;
}

// ===== API 方法集合 =====

export const api = {
  // --- 项目 ---
  projects: () => req<Project[]>("/projects"),
  createProject: (b: { name: string; description?: string }) =>
    req<Project>("/projects", { method: "POST", body: JSON.stringify(b) }),
  project: (pid: string) => req<Project>(`/projects/${pid}`),
  /** 编辑项目基础信息（乐观锁 If-Match=当前 version）。 */
  updateProject: (
    pid: string,
    b: { name?: string; description?: string },
    version: number
  ) =>
    req<Project>(`/projects/${pid}`, {
      method: "PATCH",
      headers: { "If-Match": String(version) },
      body: JSON.stringify(b),
    }),
  /** 删除项目（后端归档，列表自动隐藏）。 */
  deleteProject: (pid: string) =>
    req<{ archived: boolean }>(`/projects/${pid}`, { method: "DELETE" }),

  // --- 会话 ---
  sessions: (pid: string) => req<SessionDto[]>(`/projects/${pid}/sessions`),
  createSession: (
    pid: string,
    b: { title?: string; stage?: string; agent?: string; hitlMode?: string }
  ) =>
    req<SessionDto>(`/projects/${pid}/sessions`, {
      method: "POST",
      body: JSON.stringify(b),
    }),
  /** 重命名会话（PATCH body {title}）。 */
  renameSession: (sid: string, title: string) =>
    req<SessionDto>(`/sessions/${sid}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  /** 删除会话（后端软删除/归档，置 archived_at；列表自动隐藏）。 */
  deleteSession: (sid: string) =>
    req<{ deleted: boolean }>(`/sessions/${sid}`, { method: "DELETE" }),

  // --- 消息 ---
  messages: (sid: string) => req<MessageDto[]>(`/sessions/${sid}/messages`),
  /** 取消消息（置 status=cancelled；本地编排循环据此协作式停下）。 */
  cancelMessage: (sid: string, mid: string) =>
    req<{ cancelled: boolean }>(`/sessions/${sid}/messages/${mid}/cancel`, {
      method: "POST",
    }),
  send: (
    sid: string,
    content: string,
    hitlMode: string,
    references?: string[],
    target?: { targetType?: string | null; targetArtifactId?: string | null },
    // 划选引用片段（问题3）：非空时后端据此把意图视为定向编辑，仅改该片段
    quote?: string
  ) =>
    req<MessageDto>(`/sessions/${sid}/messages`, {
      method: "POST",
      headers: { "Idempotency-Key": idemKey() },
      body: JSON.stringify({
        role: "user",
        content,
        hitlMode,
        ...(references && references.length ? { references } : {}),
        ...(target?.targetType ? { targetType: target.targetType } : {}),
        ...(target?.targetArtifactId ? { targetArtifactId: target.targetArtifactId } : {}),
        ...(quote ? { quote } : {}),
      }),
    }),

  // --- 资料 ---
  parseMaterial: (
    pid: string,
    b: {
      source?: string;
      isText?: boolean;
      title?: string;
      file_id?: string;
      asReference?: boolean;
      scope?: string;
    }
  ) =>
    req<MaterialDto>(`/projects/${pid}/materials`, {
      method: "POST",
      body: JSON.stringify(b),
    }),
  materials: (pid: string, scope?: string) =>
    req<MaterialDto[]>(
      `/projects/${pid}/materials${scope ? `?scope=${encodeURIComponent(scope)}` : ""}`
    ),
  /** 文件解析定稿（status → finalized）。 */
  finalizeMaterial: (pid: string, mid: string) =>
    req<{ id: string; status: string }>(
      `/projects/${pid}/materials/${mid}/finalize`,
      { method: "POST" }
    ),
  /** 内容解析定稿（content_parsed → true，与文件解析定稿独立）。 */
  finalizeContentMaterial: (pid: string, mid: string) =>
    req<{ id: string; contentParsed: boolean }>(
      `/projects/${pid}/materials/${mid}/finalize-content`,
      { method: "POST" }
    ),
  /** 删除已解析资料（连同原上传文件 + 物理文件）。 */
  deleteMaterial: (pid: string, mid: string) =>
    req<{ deleted: boolean }>(`/projects/${pid}/materials/${mid}`, {
      method: "DELETE",
    }),
  /** 内容解析（翻译/索引/脱敏/知识库增强）。 */
  transformMaterial: (
    pid: string,
    mid: string,
    op: string,
    params: Record<string, any> = {}
  ) =>
    req<TransformResultDto>(`/projects/${pid}/materials/${mid}/transform`, {
      method: "POST",
      body: JSON.stringify({ op, params }),
    }),

  // --- 上传文件（临时存储） ---
  uploadFile: (pid: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return uploadReq<UploadedFileDto>(`/projects/${pid}/files/upload`, form);
  },
  listFiles: (pid: string) => req<UploadedFileDto[]>(`/projects/${pid}/files`),
  deleteFile: (pid: string, fid: string) =>
    req<{ deleted: boolean }>(`/projects/${pid}/files/${fid}`, {
      method: "DELETE",
    }),

  // --- 工件 ---
  artifacts: (pid: string, type?: string, stage?: string) => {
    const q = new URLSearchParams();
    if (type) q.set("type", type);
    if (stage) q.set("stage", stage);
    const qs = q.toString();
    return req<ArtifactDto[]>(`/projects/${pid}/artifacts${qs ? `?${qs}` : ""}`);
  },
  artifact: (aid: string) => req<ArtifactDto>(`/artifacts/${aid}`),
  updateArtifact: (aid: string, content: string, version: number, note?: string) =>
    req<{ id: string; version: number; currentVersion: number }>(`/artifacts/${aid}`, {
      method: "PUT",
      headers: { "If-Match": String(version) },
      body: JSON.stringify({ content, note }),
    }),
  diff: (aid: string, from: number, to: number) =>
    req<DiffDto>(`/artifacts/${aid}/diff?from=${from}&to=${to}`),
  rollback: (aid: string, toVersion: number) =>
    req<{ rolledBackTo: number; newVersion: number }>(`/artifacts/${aid}/rollback`, {
      method: "POST",
      body: JSON.stringify({ toVersion }),
    }),
  /** 工件定稿（status → finalized，version+1，并 publish artifact.created）。 */
  finalizeArtifact: (pid: string, aid: string) =>
    req<{ id: string; status: string }>(
      `/projects/${pid}/artifacts/${aid}/finalize`,
      { method: "POST" }
    ),
  /** 解锁定稿（status 置回 draft，version+1，try publish artifact.created）。 */
  unfinalizeArtifact: (pid: string, aid: string) =>
    req<{ id: string; status: string }>(
      `/projects/${pid}/artifacts/${aid}/unfinalize`,
      { method: "POST" }
    ),
  /** 设置 CRD/PRD 参考资料关联（写入 artifact.extra.references）。 */
  setReferences: (pid: string, aid: string, materialIds: string[]) =>
    req<{ id: string; references: string[] }>(
      `/projects/${pid}/artifacts/${aid}/references`,
      { method: "POST", body: JSON.stringify({ materialIds }) }
    ),
  /** 版本提交（与对话修改分离，落库为新版本）。 */
  submitVersion: (pid: string, aid: string, content: string, note?: string) =>
    req<{ id: string; version: number }>(
      `/projects/${pid}/artifacts/${aid}/submit-version`,
      { method: "POST", body: JSON.stringify({ content, note }) }
    ),
  /** 版本列表（无 content，正序；前端按需 reverse）。 */
  artifactVersions: (aid: string) =>
    req<Array<{ version: number; author?: string; note?: string | null; createdAt?: string }>>(
      `/artifacts/${aid}/versions`
    ),
  /** 指定版本内容。 */
  artifactVersion: (aid: string, v: number) =>
    req<{ version: number; content: string }>(`/artifacts/${aid}/versions/${v}`),

  // --- Task ---
  tasks: (pid: string) => req<TaskDto[]>(`/projects/${pid}/tasks`),
  createTasks: (pid: string, body: any) =>
    req<{ created: number }>(`/projects/${pid}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  transition: (tid: string, to: string, version: number) =>
    req<TaskDto>(`/tasks/${tid}/transitions`, {
      method: "POST",
      headers: { "If-Match": String(version) },
      body: JSON.stringify({ to }),
    }),

  // --- 待定变更 ---
  pendingChanges: (pid: string, status = "pending") =>
    req<PendingChangeDto[]>(`/projects/${pid}/pending-changes?status=${status}`),
  /** 单条待定变更（含最新 diffBlocks/status）；用于对话区与主区确认状态实时联动。 */
  pendingChange: (cid: string) => req<PendingChangeDto>(`/pending-changes/${cid}`),
  approve: (cid: string) =>
    req<{ approved: boolean }>(`/pending-changes/${cid}/approve`, { method: "POST" }),
  reject: (cid: string, reason: string) =>
    req<{ rejected: boolean }>(`/pending-changes/${cid}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  editApprove: (cid: string, editedDiff: any) =>
    req<{ approved: boolean; edited: boolean }>(`/pending-changes/${cid}/edit-approve`, {
      method: "POST",
      body: JSON.stringify({ edited_diff: editedDiff }),
    }),
  /** M4 P1-A：按块 resolve（confirmed / rejected / pending）。 */
  resolveBlock: (cid: string, blockId: string, state: "confirmed" | "rejected" | "pending") =>
    req<{
      resolved: boolean;
      blockId: string;
      state: string;
      finalized: boolean;
      status?: string;
    }>(`/pending-changes/${cid}/blocks/${blockId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ state }),
    }),

  // --- RTM 追溯矩阵 ---
  rtm: (pid: string) => req<RtmReport>(`/projects/${pid}/rtm/report`),
  /** 完整 RTM（nodes + edges + report）；matrix 页面层×层热力网格用。 */
  rtmFull: (pid: string) => req<RtmFullDto>(`/projects/${pid}/rtm`),

  // --- 通知中心（M4 P2 5.1） ---
  notifications: (pid: string, unread = false) =>
    req<NotificationDto[]>(
      `/projects/${pid}/notifications${unread ? "?unread=true" : ""}`
    ),
  readNotification: (pid: string, nid: string) =>
    req<{ read: boolean }>(`/projects/${pid}/notifications/${nid}/read`, {
      method: "POST",
    }),
  readAllNotifications: (pid: string) =>
    req<{ read: boolean }>(`/projects/${pid}/notifications/read-all`, {
      method: "POST",
    }),
  seedNotifications: (pid: string) =>
    req<{ seeded: number; skipped?: boolean }>(
      `/projects/${pid}/notifications/seed`,
      { method: "POST" }
    ),

  // --- 自检 / 定稿 ---
  selfcheck: (pid: string, sid: string) =>
    req<SelfCheckResult>(`/projects/${pid}/selfcheck`, {
      method: "POST",
      body: JSON.stringify({ sessionId: sid }),
    }),
  finalize: (pid: string, sid: string, force: boolean) =>
    req<{ finalized: boolean; forced: boolean; allGreen: boolean }>(
      `/projects/${pid}/finalize`,
      { method: "POST", body: JSON.stringify({ sessionId: sid, force }) }
    ),

  // --- 委派 ---
  delegateAudits: (pid: string) =>
    req<DelegateAuditDto[]>(`/projects/${pid}/delegate-audits`),
  delegate: (
    pid: string,
    b: { sessionId: string; target: string; payload: any; hitlMode: string }
  ) => req<any>(`/projects/${pid}/delegate`, { method: "POST", body: JSON.stringify(b) }),

  // --- 设置 ---
  getSettings: (pid: string, sid?: string) =>
    req<Record<string, any>>(
      `/projects/${pid}/settings${sid ? `?sid=${sid}` : ""}`
    ),
  endpoints: (pid: string) => req<EndpointDto[]>(`/projects/${pid}/endpoints`),
  createEndpoint: (
    pid: string,
    b: {
      kind: string;
      name: string;
      baseUrl?: string;
      model?: string;
      apiKey?: string;
      provider?: string;
    }
  ) =>
    req<{ id: string; name: string }>(`/projects/${pid}/endpoints`, {
      method: "POST",
      // provider 经 extra 透传给后端（仅当有值），其余字段平铺
      body: JSON.stringify({
        kind: b.kind,
        name: b.name,
        baseUrl: b.baseUrl,
        model: b.model,
        apiKey: b.apiKey,
        ...(b.provider ? { extra: { provider: b.provider } } : {}),
      }),
    }),
  /** 删除端点。 */
  deleteEndpoint: (pid: string, eid: string) =>
    req<{ deleted: boolean }>(`/projects/${pid}/endpoints/${eid}`, {
      method: "DELETE",
    }),
  testEndpoint: (pid: string, eid: string) =>
    req<{ reachable: boolean; status?: number; error?: string }>(
      `/projects/${pid}/endpoints/${eid}/test`,
      { method: "POST" }
    ),
  putOverride: (pid: string, sid: string, category: string, key: string, value: any) =>
    req<{ category: string; key: string; value: any }>(
      `/projects/${pid}/sessions/${sid}/override`,
      { method: "PUT", body: JSON.stringify({ category, key, value }) }
    ),
  settingAudit: (pid: string) =>
    req<SettingAuditDto[]>(`/projects/${pid}/setting-audit`),

  // --- 能力库（Phase 3.5 能力进化双环） ---
  capabilities: () => req<CapabilityDto[]>(`/internal/capability/list`),
  capabilityVersions: (aid: string) =>
    req<CapabilityVersionDto[]>(`/internal/capability/${aid}/versions`),
  proposeCapability: (b: {
    name: string;
    kind: "skill" | "prompt" | "agent_md";
    draft: string;
    rationale: string;
  }) =>
    req<{ version_id: string; pending_change_id: string; artifact_id: string }>(
      `/internal/capability/propose`,
      { method: "POST", body: JSON.stringify(b) }
    ),
  approveCapability: (pendingChangeId: string) =>
    req<{ approved: boolean }>(`/internal/capability/approve`, {
      method: "POST",
      body: JSON.stringify({ pending_change_id: pendingChangeId }),
    }),
  applyCapability: (versionId: string) =>
    req<{ kind: string; name: string; content: string; score: number }>(
      `/internal/capability/apply`,
      { method: "POST", body: JSON.stringify({ version_id: versionId }) }
    ),
  rollbackCapability: (versionId: string) =>
    req<{ kind: string; name: string; content: string; version: number }>(
      `/internal/capability/rollback`,
      { method: "POST", body: JSON.stringify({ version_id: versionId }) }
    ),

  // --- 各阶段 Agent Prompt 多版本配置 ---
  agentPrompts: (pid: string) =>
    req<AgentPromptSlotDto[]>(`/projects/${pid}/agent-prompts`),
  agentPromptVersion: (pid: string, slot: string, v: number) =>
    req<{ version: number; name: string; content: string; readonly: boolean }>(
      `/projects/${pid}/agent-prompts/${slot}/versions/${v}`
    ),
  createAgentPromptVersion: (
    pid: string,
    slot: string,
    b: { content: string; name: string }
  ) =>
    req<{ version: number; name: string }>(
      `/projects/${pid}/agent-prompts/${slot}/versions`,
      { method: "POST", body: JSON.stringify(b) }
    ),
  renameAgentPromptVersion: (pid: string, slot: string, v: number, name: string) =>
    req<{ version: number; name: string }>(
      `/projects/${pid}/agent-prompts/${slot}/versions/${v}`,
      { method: "PATCH", body: JSON.stringify({ name }) }
    ),
  /** 美化提示词（调大模型/agent 把草稿整理为规范提示词，返回整理后内容）。 */
  beautifyAgentPrompt: (pid: string, slot: string, content: string) =>
    req<{ content: string }>(
      `/projects/${pid}/agent-prompts/${slot}/beautify`,
      { method: "POST", body: JSON.stringify({ content }) }
    ),
  setAgentPromptCurrent: (pid: string, slot: string, version: number) =>
    req<{ slot: string; currentVersion: number }>(
      `/projects/${pid}/agent-prompts/${slot}/current`,
      { method: "PUT", body: JSON.stringify({ version }) }
    ),
  deleteAgentPromptVersion: (pid: string, slot: string, v: number) =>
    req<{ deleted: boolean; currentVersion: number }>(
      `/projects/${pid}/agent-prompts/${slot}/versions/${v}`,
      { method: "DELETE" }
    ),
};

export interface AgentPromptVersionMeta {
  version: number;
  name: string;
  author?: string;
  readonly: boolean;
  createdAt?: string | null;
}

export interface AgentPromptSlotDto {
  slot: string;
  title: string;
  artifactId: string;
  currentVersion: number;
  defaultContent: string;
  versions: AgentPromptVersionMeta[];
}

export interface CapabilityDto {
  id: string;
  kind: "skill" | "prompt" | "agent_md";
  name: string;
  currentVersion: number;
  latestVersionId?: string | null;
  content: string;
  status?: string;
}

export interface CapabilityVersionDto {
  versionId: string;
  version: number;
  author: string;
  note?: string | null;
  content: string;
}

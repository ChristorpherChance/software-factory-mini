// agent-service HTTP/WS 服务（fastify + @fastify/websocket）。
// 鉴权复用 Authorization: Bearer <AUTH_BEARER_TOKEN>（health 放行）。
// 契约：成功 {data,meta}；错误 {error:{code,message,details,requestId}}。
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { AgentManager } from "./agentManager.js";

const TOKEN = process.env.AUTH_BEARER_TOKEN ?? "dev-single-workspace-token";
const PORT = Number(process.env.PORT ?? 9100);

const app = Fastify({ logger: { redact: ["req.headers.authorization"] } });
await app.register(websocket);

const ok = (data: unknown) => ({ data, meta: { ts: Date.now() } });
const errEnv = (code: string, message: string, id: string) => ({
  error: { code, message, details: null, requestId: id },
});

// 鉴权（health 放行）
app.addHook("onRequest", async (req, reply) => {
  if (req.url.startsWith("/v1/health")) return;
  if (req.headers["authorization"] !== `Bearer ${TOKEN}`) {
    reply.code(401).send(errEnv("UNAUTHORIZED", "bad token", String(req.id)));
  }
});

const manager = new AgentManager();

app.get("/v1/health", async () => ok({ status: "ok" }));

app.post("/v1/structure", async (req) => {
  const { text, session_id } = z
    .object({ text: z.string(), session_id: z.string().nullish() })
    .parse(req.body);
  return ok(await manager.runStructure(text, session_id ?? undefined));
});

app.post("/v1/requirement", async (req) => {
  const { kind, upstream, session_id } = z
    .object({ kind: z.string(), upstream: z.string(), session_id: z.string().nullish() })
    .parse(req.body);
  const markdown = await manager.runRequirement(kind, upstream, session_id ?? undefined);
  return ok({ markdown });
});

app.post("/v1/sessions", async (req) => {
  const { session_id } = z.object({ session_id: z.string().nullish() }).parse(req.body ?? {});
  return ok({ session_id: manager.ensure(session_id ?? undefined) });
});

app.post<{ Params: { id: string } }>("/v1/sessions/:id/messages", async (req) => {
  const { id } = req.params;
  const { content } = z.object({ content: z.string() }).parse(req.body);
  manager.postMessage(id, content);
  return ok({ accepted: true });
});

app.post<{ Params: { id: string } }>("/v1/sessions/:id/hitl", async (req) => {
  const { id } = req.params;
  const body = z
    .object({
      reqId: z.string(),
      decision: z.enum(["allow", "rewrite", "deny"]),
      input: z.any().optional(),
    })
    .parse(req.body);
  manager.resolveHitl(id, body);
  return ok({ resolved: true });
});

app.post<{ Params: { id: string } }>("/v1/sessions/:id/interrupt", async (req) => {
  const { id } = req.params;
  await manager.interrupt(id);
  return ok({ interrupted: true });
});

// WS 真流式：客户端 {type:'message',content} / {type:'hitl',...}；服务端推 message.delta/.end/tool.call/hitl.request
app.get<{ Params: { id: string } }>("/v1/sessions/:id", { websocket: true }, (conn, req) => {
  const { id } = req.params;
  const session = manager.ensureSession(id);
  const socket = (conn as any).socket ?? conn; // @fastify/websocket v10：conn 即 socket
  const unsub = session.subscribe((ev) => {
    try {
      socket.send(JSON.stringify(ev));
    } catch {
      /* socket 已关 */
    }
  });
  socket.on("message", (raw: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "message" && typeof msg.content === "string") session.post(msg.content);
    if (msg.type === "hitl") session.resolveHitl(msg);
  });
  socket.on("close", () => unsub());
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(
  () => app.log.info(`agent-service listening on :${PORT}`),
  (e) => {
    app.log.error(e);
    process.exit(1);
  },
);

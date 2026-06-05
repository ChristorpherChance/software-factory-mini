// 回调 FastAPI 的统一出口（铁律#4：token 仅内存，不打日志）。
const BACKEND = process.env.BACKEND_ORIGIN ?? "http://localhost:8001";
const TOKEN = process.env.AUTH_BEARER_TOKEN ?? "dev-single-workspace-token";

export async function callBackend<T = any>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`backend ${path} -> ${r.status}`);
  const json = (await r.json()) as { data?: T };
  return json.data as T;
}

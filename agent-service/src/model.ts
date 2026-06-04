// DeepSeek（OpenAI 兼容）Model 工厂 + provider 注册。
// pi-ai 原生支持 provider="deepseek" + api="openai-completions"，DeepSeek 走 OpenAI 兼容协议。
// 模型名 / baseUrl / key 全部从 env 读，默认按用户确认值（铁律#4：key 仅内存）。
import {
  registerBuiltInApiProviders,
  streamSimple,
  type Model,
} from "@earendil-works/pi-ai";

let registered = false;

/** 注册内置 provider（含 openai-completions），幂等。 */
export function ensureProviders(): void {
  if (registered) return;
  registerBuiltInApiProviders();
  registered = true;
}

/** 构造 DeepSeek Model（OpenAI 兼容端点）。 */
export function buildModel(): Model<"openai-completions"> {
  return {
    id: process.env.LLM_MODEL ?? "deepseek-v4-pro",
    name: "DeepSeek",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: process.env.LLM_BASE_URL ?? "https://api.deepseek.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 65536,
    maxTokens: 8192,
  };
}

/** 流式函数（通用入口，按 model.api 路由到 openai-completions provider）。 */
export const streamFn = streamSimple;

/** 取 API Key（仅内存，绝不落盘/打日志）。 */
export function getApiKey(): string {
  return process.env.LLM_API_KEY ?? "";
}

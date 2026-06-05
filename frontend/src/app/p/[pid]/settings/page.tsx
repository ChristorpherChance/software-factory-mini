"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScrollText, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentPromptsTab } from "./AgentPromptsTab";

const CATS = ["agents", "model", "hitl", "kb", "sandbox", "endpoint", "general"] as const;
const LABEL: Record<string, string> = {
  agents: "Agent 配置",
  model: "模型",
  hitl: "HITL",
  kb: "知识库",
  sandbox: "沙箱",
  endpoint: "端点",
  general: "通用",
};

export default function SettingsPage() {
  const { pid } = useParams<{ pid: string }>();
  const [tab, setTab] = useState<(typeof CATS)[number]>("agents");

  const { data: cfg } = useQuery({
    queryKey: ["settings", pid],
    queryFn: () => api.getSettings(pid),
    enabled: !!pid,
  });

  return (
    <div className="flex gap-4 p-4">
      <nav className="w-32 shrink-0 space-y-1">
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => setTab(c)}
            className={cn(
              "block w-full rounded-md px-2 py-1 text-left text-sm",
              tab === c
                ? "bg-primary-subtle text-primary"
                : "text-text-secondary hover:bg-bg-subtle"
            )}
          >
            {LABEL[c]}
          </button>
        ))}
        <Link
          href={`/p/${pid}/settings/audit`}
          className="mt-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-bg-subtle"
        >
          <ScrollText className="h-4 w-4" /> 变更审计
        </Link>
      </nav>

      <section className="flex-1">
        {tab === "agents" ? (
          <AgentPromptsTab pid={pid} />
        ) : tab === "endpoint" ? (
          <EndpointsTab pid={pid} />
        ) : (
          <KvTab cat={tab} cfg={(cfg?.[tab] as Record<string, any>) ?? {}} />
        )}
      </section>
    </div>
  );
}

function KvTab({ cat, cfg }: { cat: string; cfg: Record<string, any> }) {
  const entries = Object.entries(cfg);
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-text">{LABEL[cat]} 设置</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-text-muted">暂无配置项（使用默认值）。</p>
      ) : (
        entries.map(([k, v]) => (
          <div
            key={k}
            className="flex items-center justify-between border-b border-border py-1.5 text-sm"
          >
            <span className="text-text-secondary">{k}</span>
            <span className="font-mono text-text">
              {v?.masked
                ? v.hint
                : typeof v === "object"
                ? JSON.stringify(v)
                : String(v)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// 端点表单形态
type EndpointForm = {
  kind: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  provider: string;
};

const EMPTY_FORM: EndpointForm = {
  kind: "llm",
  name: "",
  baseUrl: "",
  model: "",
  apiKey: "",
  provider: "openai",
};

// 可选 provider（与 ModelPicker 分组、后端路由对齐）
const PROVIDERS = ["openai", "ollama", "deepseek", "qwen", "anthropic"] as const;

// 快速预设：点击只预填表单，仍由用户点「新增端点」提交
const PRESETS: Array<{ label: string; patch: Partial<EndpointForm> }> = [
  {
    label: "Ollama(本地)",
    patch: {
      name: "Ollama 本地",
      provider: "ollama",
      baseUrl: "http://localhost:11434/v1",
      model: "qwen2.5",
    },
  },
  {
    label: "通义千问 Qwen",
    patch: {
      name: "通义千问",
      provider: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
    },
  },
  {
    label: "DeepSeek",
    patch: {
      name: "DeepSeek",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    },
  },
  {
    label: "Claude 代理(opus)",
    patch: {
      name: "Claude 代理",
      provider: "openai",
      baseUrl: "https://your-proxy/v1",
      model: "claude-opus-4",
    },
  },
];

function EndpointsTab({ pid }: { pid: string }) {
  const qc = useQueryClient();
  const { data: eps } = useQuery({
    queryKey: ["endpoints", pid],
    queryFn: () => api.endpoints(pid),
    enabled: !!pid,
  });
  const [form, setForm] = useState<EndpointForm>(EMPTY_FORM);
  // 记录每个端点的连通性测试结果
  const [results, setResults] = useState<Record<string, { reachable: boolean }>>({});

  const create = useMutation({
    // provider 一并传给后端（契约：createEndpoint 接收 provider → extra.provider）
    mutationFn: () => api.createEndpoint(pid, form),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["endpoints", pid] });
    },
  });

  const remove = useMutation({
    mutationFn: (eid: string) => api.deleteEndpoint(pid, eid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["endpoints", pid] }),
  });

  const test = useMutation({
    mutationFn: (eid: string) => api.testEndpoint(pid, eid),
    onSuccess: (res, eid) =>
      setResults((r) => ({ ...r, [eid]: { reachable: !!res.reachable } })),
  });

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-text">端点管理</h3>

      {/* 端点卡片列表 */}
      <ul className="space-y-2">
        {(eps ?? []).map((e) => (
          <li
            key={e.id}
            className="rounded-md border border-border bg-bg-subtle p-2.5 text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-text">{e.name}</span>
                  {e.provider && (
                    <span className="rounded-full bg-primary-subtle px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      {e.provider}
                    </span>
                  )}
                  <span className="text-[11px] text-text-muted">{e.kind}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                  {e.model && <span className="font-mono">{e.model}</span>}
                  <span>{e.hasKey ? "🔑 已配置密钥" : "无密钥"}</span>
                  <span>{e.enabled ? "已启用" : "已停用"}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {results[e.id] && <span>{results[e.id].reachable ? "✅" : "❌"}</span>}
                <button
                  onClick={() => test.mutate(e.id)}
                  disabled={test.isPending}
                  className="text-primary hover:underline"
                >
                  测连通
                </button>
                <button
                  onClick={() => remove.mutate(e.id)}
                  disabled={remove.isPending}
                  title="删除端点"
                  className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-error-subtle hover:text-error disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </li>
        ))}
        {(eps ?? []).length === 0 && (
          <li className="text-sm text-text-muted">暂无端点，下方新增。</li>
        )}
      </ul>

      {/* 快速预设：点击仅预填表单 */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-secondary">快速预设</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setForm((f) => ({ ...f, ...p.patch }))}
              className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-text-secondary hover:border-primary hover:text-primary"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 新增表单 */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="col-span-2 flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-text-secondary">提供方</span>
          <select
            className="flex-1 rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-primary"
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {(["name", "baseUrl", "model", "apiKey"] as const).map((f) => (
          <input
            key={f}
            placeholder={f}
            type={f === "apiKey" ? "password" : "text"}
            className="rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-primary"
            value={form[f]}
            onChange={(e) => setForm({ ...form, [f]: e.target.value })}
          />
        ))}
      </div>
      <Button
        variant="primary"
        size="sm"
        onClick={() => create.mutate()}
        disabled={create.isPending || !form.name.trim()}
      >
        新增端点
      </Button>
    </div>
  );
}

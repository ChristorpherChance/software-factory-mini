"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
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

function EndpointsTab({ pid }: { pid: string }) {
  const qc = useQueryClient();
  const { data: eps } = useQuery({
    queryKey: ["endpoints", pid],
    queryFn: () => api.endpoints(pid),
    enabled: !!pid,
  });
  const [form, setForm] = useState({
    kind: "llm",
    name: "",
    baseUrl: "",
    model: "",
    apiKey: "",
  });
  // 记录每个端点的连通性测试结果
  const [results, setResults] = useState<Record<string, { reachable: boolean }>>({});

  const create = useMutation({
    mutationFn: () => api.createEndpoint(pid, form),
    onSuccess: () => {
      setForm({ kind: "llm", name: "", baseUrl: "", model: "", apiKey: "" });
      qc.invalidateQueries({ queryKey: ["endpoints", pid] });
    },
  });

  const test = useMutation({
    mutationFn: (eid: string) => api.testEndpoint(pid, eid),
    onSuccess: (res, eid) =>
      setResults((r) => ({ ...r, [eid]: { reachable: !!res.reachable } })),
  });

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-text">端点管理</h3>
      <ul className="space-y-1">
        {(eps ?? []).map((e) => (
          <li
            key={e.id}
            className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
          >
            <span className="text-text">
              {e.kind} · {e.name}{" "}
              <span className="text-text-muted">{e.model}</span>
            </span>
            <span className="flex items-center gap-2">
              <span>{e.hasKey ? "🔑" : "—"}</span>
              <button
                onClick={() => test.mutate(e.id)}
                disabled={test.isPending}
                className="text-primary hover:underline"
              >
                测连通
              </button>
              {results[e.id] && <span>{results[e.id].reachable ? "✅" : "❌"}</span>}
            </span>
          </li>
        ))}
        {(eps ?? []).length === 0 && (
          <li className="text-sm text-text-muted">暂无端点，下方新增。</li>
        )}
      </ul>

      <div className="grid grid-cols-2 gap-2 text-sm">
        {(["name", "baseUrl", "model", "apiKey"] as const).map((f) => (
          <input
            key={f}
            placeholder={f}
            type={f === "apiKey" ? "password" : "text"}
            className="rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-primary"
            value={(form as any)[f]}
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

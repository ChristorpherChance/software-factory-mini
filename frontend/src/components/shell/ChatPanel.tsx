"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wifi,
  WifiOff,
  Send,
  Plus,
  Pencil,
  Trash2,
  PanelRightClose,
  ChevronDown,
  Square,
  Paperclip,
  AtSign,
  Brain,
  Bot,
  Archive,
  ArrowDown,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { api, type EndpointDto } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSseStream } from "@/hooks/useSseStream";
import { useSessionBootstrap } from "@/hooks/useSessionBootstrap";
import { useSessionStore } from "@/stores/session";
import { useHitlStore } from "@/stores/hitl";
import { useSettingStore } from "@/stores/setting";
import { useToolCallStore } from "@/stores/toolcall";
import { useEditTargetStore } from "@/stores/editTarget";
import { MessageStream } from "@/components/chat/MessageStream";
import { TaskProgress } from "@/components/chat/TaskProgress";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// 对话区（M4 P1-B）：
// - ChatHeader: 会话名 pill + 新建/编辑/删除/更多
// - HitlSwitch + InlineSettingBadges 保留（套原型密度）
// - ProgressBar: streaming 时显示（章节/计时/上下文 C 占位）
// - TaskProgress: 真实 task + SSE
// - MessageStream: 思考折叠 + ToolCallCard + PendingActions
// - InputArea: 新动态条(C 占位) + textarea + 6 工具 icon (C 占位) + 发送
// - 左缘 8px 拖拽手柄（保留 320-640 钳制）
export function ChatPanel() {
  const { pid } = useParams<{ pid: string }>();
  const urlSid = useSearchParams().get("sid");
  const qc = useQueryClient();

  useSessionBootstrap(pid, urlSid);

  const sid = useSessionStore((s) => s.sid);
  const conn = useSessionStore((s) => s.connState);
  const push = useSessionStore((s) => s.push);
  const messages = useSessionStore((s) => s.messages);
  const setSid = useSessionStore((s) => s.setSid);
  const resetSession = useSessionStore((s) => s.reset);
  const hydrateMessages = useSessionStore((s) => s.hydrate);
  const resetToolCalls = useToolCallStore((s) => s.reset);
  const mode = useHitlStore((s) => s.mode);
  const hydrateSetting = useSettingStore((s) => s.hydrate);
  const setChatWidth = useSettingStore((s) => s.setChatWidth);
  const setChatCollapsed = useSettingStore((s) => s.setChatCollapsed);
  // 当前主区工件（供对话定向编辑定位目标，问题2）
  const editTargetType = useEditTargetStore((s) => s.targetType);
  const editTargetId = useEditTargetStore((s) => s.targetArtifactId);
  // 划选引用片段（问题3）：发送时随 quote 透传给后端做定向编辑
  const quoteText = useEditTargetStore((s) => s.quoteText);
  const setQuote = useEditTargetStore((s) => s.setQuote);

  const dragging = useRef(false);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useSseStream(sid);

  useQuery({
    queryKey: ["settings", pid, sid],
    queryFn: async () => {
      const cfg = await api.getSettings(pid, sid ?? undefined);
      hydrateSetting(cfg);
      return cfg;
    },
    enabled: !!pid,
  });

  // 会话列表（用于头部下拉切换）
  const { data: sessions } = useQuery({
    queryKey: ["sessions", pid],
    queryFn: () => api.sessions(pid),
    enabled: !!pid,
  });
  const currentSession = sessions?.find((s) => s.id === sid);

  // 新建会话
  const createSession = useMutation({
    mutationFn: () =>
      api.createSession(pid, {
        title: "新会话",
        stage: "requirement",
        hitlMode: mode,
      }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["sessions", pid] });
      resetSession();
      resetToolCalls();
      setSid(s.id);
    },
  });

  // 切换历史会话：bootstrap 仅依赖 [pid, urlSid]，运行期改 sid 不会重 hydrate，
  // 故手动 reset + setSid + 拉取并 hydrate 该会话历史消息。
  const switchSession = useCallback(
    async (id: string) => {
      if (!id || id === sid) return;
      resetSession();
      resetToolCalls();
      setSid(id);
      try {
        const msgs = await api.messages(id);
        hydrateMessages(
          (msgs ?? []).map((m) => ({ id: m.id, role: m.role, content: m.content }))
        );
      } catch {
        /* 后端不可达静默；发送时会提示 */
      }
    },
    [sid, resetSession, resetToolCalls, setSid, hydrateMessages]
  );

  // 重命名当前会话（问题5）：prompt 取新名 → PATCH → 失效会话列表
  const renameSession = useMutation({
    mutationFn: (title: string) => api.renameSession(sid!, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions", pid] }),
  });

  // 删除当前会话（问题5）：软删除/归档 → 失效列表；删的是当前会话则切到其余之一或重置
  const deleteSession = useMutation({
    mutationFn: () => api.deleteSession(sid!),
    onSuccess: () => {
      const removed = sid;
      qc.invalidateQueries({ queryKey: ["sessions", pid] });
      // 删的是当前会话：切到剩余任一会话，无剩余则重置（清空 sid 显示）
      if (removed) {
        const rest = (sessions ?? []).filter((s) => s.id !== removed);
        resetSession();
        resetToolCalls();
        if (rest.length > 0) {
          // 复用切换逻辑加载目标会话历史
          void switchSession(rest[0].id);
        } else {
          setSid(null);
        }
      }
    },
  });

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setChatWidth(window.innerWidth - e.clientX);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setChatWidth]);

  const submit = async () => {
    if (!sid || !text.trim() || sending) return;
    const content = text.trim();
    setText("");
    setSending(true);
    push({ id: `local-${Date.now()}`, role: "user", content });
    try {
      // 透传当前主区工件（问题2）+ 划选引用片段（问题3，非空时后端做定向最小改动）
      await api.send(
        sid,
        content,
        mode,
        undefined,
        { targetType: editTargetType, targetArtifactId: editTargetId },
        quoteText || undefined
      );
      // 发送成功后清除引用 chip
      setQuote(null);
    } catch {
      push({
        id: `err-${Date.now()}`,
        role: "assistant",
        content: "⚠️ 消息发送失败（后端不可达或会话未就绪）。",
      });
    } finally {
      setSending(false);
    }
  };

  // 是否处于流式（用于 ProgressBar 显隐）
  const streaming = messages.some((m) => m.streaming);

  return (
    <section className="relative flex flex-col overflow-hidden border-l border-border bg-bg-elevated">
      {/* 拖拽手柄 */}
      <div
        onMouseDown={onMouseDown}
        className="group absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize"
        aria-label="拖拽调整对话区宽度"
      >
        <div className="absolute left-0 top-1/2 h-16 w-1.5 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {/* ChatHeader：会话名 pill + 新建/编辑/删除/更多 icon */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-bg-subtle px-2.5 py-1.5 hover:bg-border/40"
              title="切换历史会话"
            >
              <span className="truncate text-[13px] font-semibold text-text">
                💬 {currentSession?.title ?? "主会话"}
              </span>
              <span
                className={cnConn(conn)}
                title={conn === "open" ? "已连接" : conn === "reconnecting" ? "重连中" : "未连接"}
              />
              <ChevronDown className="h-3 w-3 text-text-muted" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
            <DropdownMenuLabel>历史会话</DropdownMenuLabel>
            {(sessions ?? []).length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-text-muted">暂无会话</p>
            ) : (
              (sessions ?? []).map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onSelect={() => switchSession(s.id)}
                  className="flex-col items-start gap-0.5"
                >
                  <span className="flex w-full items-center gap-1.5">
                    {s.id === sid && <span className="text-primary">●</span>}
                    <span className="truncate text-[13px] font-medium text-text">
                      {s.title ?? "未命名会话"}
                    </span>
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {s.stage ?? "—"} · {s.status ?? "active"}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-0.5">
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-subtle"
            onClick={() => createSession.mutate()}
            disabled={createSession.isPending}
            title="新建会话"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {/* 重命名当前会话（问题5）：prompt 取新名 */}
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
            disabled={!sid || renameSession.isPending}
            onClick={() => {
              if (!sid) return;
              const next = window.prompt(
                "重命名会话",
                currentSession?.title ?? ""
              );
              const title = next?.trim();
              if (title && title !== currentSession?.title) {
                renameSession.mutate(title);
              }
            }}
            title="重命名会话"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {/* 删除当前会话（问题5）：确认后软删除 */}
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
            disabled={!sid || deleteSession.isPending}
            onClick={() => {
              if (!sid) return;
              if (window.confirm("删除当前会话？该操作会归档会话。")) {
                deleteSession.mutate();
              }
            }}
            title="删除会话"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {/* 收拢对话区（问题4）：折叠后右下角悬浮小人可重新展开 */}
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-subtle"
            onClick={() => setChatCollapsed(true)}
            title="收拢对话区"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ProgressBar：streaming 才显示；只保留「停止」按钮（问题5） */}
      {streaming && <ProgressBar sid={sid} />}

      {/* Task 进度（接 useTaskStore + api.tasks，B 档） */}
      <TaskProgress />

      <MessageStream />

      {/* InputArea：新动态条 + textarea + 6 工具 icon + 发送 */}
      <InputArea
        pid={pid}
        sid={sid}
        text={text}
        setText={setText}
        sending={sending}
        submit={submit}
      />
    </section>
  );
}

/** 连接态小圆点（融合到 ChatHeader 的会话 pill 内）。 */
function cnConn(s: string): string {
  const base = "h-1.5 w-1.5 rounded-full";
  if (s === "open") return `${base} bg-success`;
  if (s === "reconnecting") return `${base} bg-warning animate-pulse`;
  return `${base} bg-text-muted`;
}

function ProgressBar({ sid }: { sid: string | null }) {
  // C 档：标题 / 计时 / 上下文用量 暂为静态文案；真实接入需要后端额外字段（TODO）
  // 停止（问题1）：立即停掉当前流式消息——标记为已停止后，store 会忽略其后续 SSE 增量，
  //   ▋ 立即消失且不再输出任何内容；同时通知后端协作式中止（尽力而为）。
  const onStop = async () => {
    const mid = useSessionStore.getState().messages.find((m) => m.streaming)?.id;
    if (!mid) return;
    useSessionStore.getState().cancelStream(mid);
    if (sid) {
      try {
        await api.cancelMessage(sid, mid);
      } catch {
        /* 后端不可达静默；本地已立即停止 */
      }
    }
  };

  return (
    <div className="space-y-1.5 border-b border-border bg-primary-subtle px-3.5 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-primary">▶ 生成中…</span>
        <button
          onClick={onStop}
          title="停止生成（保留已输出内容）"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-error hover:bg-error/10"
        >
          <Square className="h-3.5 w-3.5" />
          停止
        </button>
      </div>
      <div className="text-[11px] text-text-secondary">
        承接：@编排Agent · 上下文用量 — (TODO)
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-bg">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-warning" />
      </div>
    </div>
  );
}

function InputArea({
  pid,
  sid,
  text,
  setText,
  sending,
  submit,
}: {
  pid: string;
  sid: string | null;
  text: string;
  setText: (v: string) => void;
  sending: boolean;
  submit: () => void;
}) {
  // 划选引用片段（问题3）：主区划选后 setQuote 写入，这里读取显示引用条
  const quoteText = useEditTargetStore((s) => s.quoteText);
  const setQuote = useEditTargetStore((s) => s.setQuote);

  const tools = [
    { Icon: Paperclip, label: "上传材料（TODO）" },
    { Icon: AtSign,    label: "@ 引用工件（TODO）" },
    { Icon: Brain,     label: "思考模式（TODO）" },
    { Icon: Archive,   label: "归档（TODO）" },
  ];

  return (
    <div className="space-y-2 border-t border-border bg-bg-elevated px-3 pb-3 pt-2.5">
      {/* 新动态条（C 档：未读消息提示静态） */}
      <div className="flex items-center justify-between rounded-md bg-[#E0F2FE] px-2.5 py-1.5 text-xs text-[#0369A1] dark:bg-[#0C2A3D] dark:text-[#7DD3FC]">
        <span>📨 — 条新动态（TODO 真实数据源）</span>
        <button className="hover:underline">查看 ›</button>
      </div>
      <div className="space-y-2 rounded-[10px] border border-border bg-bg p-2.5">
        {/* 引用 chip（问题3）：非空时显示在 textarea 上方，✕ 清除引用 */}
        {quoteText && (
          <div className="flex items-start gap-1.5 rounded-md border border-primary/30 bg-primary-subtle px-2 py-1.5 text-[11px] text-primary">
            <span className="mt-px shrink-0 font-semibold">引用：</span>
            <span className="min-w-0 flex-1 truncate" title={quoteText}>
              {quoteText.length > 40 ? `${quoteText.slice(0, 40)}…` : quoteText}
            </span>
            <button
              onClick={() => setQuote(null)}
              title="取消引用"
              className="shrink-0 rounded hover:bg-primary/15"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          disabled={!sid}
          placeholder={
            !sid
              ? "建立会话中…"
              : quoteText
                ? "已引用所选片段，输入修改要求…"
                : "输入消息，或 @ 引用工件 / 📎 上传材料…"
          }
          className="sf-scroll w-full resize-none bg-transparent text-[13px] leading-relaxed text-text outline-none placeholder:text-text-muted"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5">
            {tools.map(({ Icon, label }, i) => (
              <button
                key={i}
                className="flex h-6 w-6 items-center justify-center rounded-md text-text-secondary hover:bg-bg-subtle"
                title={label}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {/* 模型选择（移到发送按钮左边） */}
            <ModelPicker pid={pid} sid={sid} />
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={!sid || !text.trim() || sending}
            >
              <Send className="h-3.5 w-3.5" /> 发送
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 端点连通性检测态（问题2）：checking 进行中 / ok 可连通 / fail 不可连通
type ReachState = "checking" | "ok" | "fail";

/** 模型选择器：列出项目 LLM 端点，仅「已配置并能连通」可选（问题2）。 */
function ModelPicker({ pid, sid }: { pid: string; sid: string | null }) {
  const qc = useQueryClient();
  const model = useSettingStore((s) => s.model);
  const { data: endpoints } = useQuery({
    queryKey: ["endpoints", pid],
    queryFn: () => api.endpoints(pid),
    enabled: !!pid,
  });
  const llm = (endpoints ?? []).filter((e) => e.kind === "llm" && e.enabled);
  const pick = useMutation({
    // 存端点 id（后端 resolve_llm_endpoint 按 id 优先匹配），避免与 model 串名不一致
    mutationFn: (endpointId: string) => api.putOverride(pid, sid!, "model", "name", endpointId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", pid] }),
  });
  // 覆盖值现在是端点 id；触发器标签按 id 查回该端点的 model（无则 name），无覆盖显示「默认」
  const selected = llm.find((e) => e.id === model?.name);
  const current = selected ? selected.model ?? selected.name : "默认";

  // 按 provider 分组：provider 为空归到「其它 / 默认」组，常见 provider 排前
  const groups = groupByProvider(llm);

  // 连通性检测结果（按端点 id 缓存），避免每次渲染重复请求
  const [reach, setReach] = useState<Record<string, ReachState>>({});
  // 是否已对当前端点集合发起过检测（仅打开时触发一次）
  const testedRef = useRef(false);

  // 打开下拉时一次性检测所有 llm 端点连通性
  const onOpenChange = (open: boolean) => {
    if (!open || testedRef.current || llm.length === 0) return;
    testedRef.current = true;
    setReach(Object.fromEntries(llm.map((e) => [e.id, "checking" as ReachState])));
    for (const e of llm) {
      api
        .testEndpoint(pid, e.id)
        .then((r) =>
          setReach((prev) => ({ ...prev, [e.id]: r.reachable ? "ok" : "fail" }))
        )
        .catch(() => setReach((prev) => ({ ...prev, [e.id]: "fail" })));
    }
  };

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          disabled={!sid}
          className="flex items-center gap-1 rounded-md border border-border bg-bg-subtle px-2 py-1 text-xs text-text-secondary hover:bg-border/40 disabled:opacity-50"
          title="选择模型"
        >
          <Bot className="h-3.5 w-3.5" />
          <span className="max-w-[120px] truncate">{current}</span>
          <ChevronDown className="h-3 w-3 text-text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-60 overflow-y-auto sf-scroll">
        <DropdownMenuLabel>模型 / 端点</DropdownMenuLabel>
        {llm.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-text-muted">
            无可用 LLM 端点，可在设置页添加
          </p>
        ) : (
          groups.map((grp, gi) => (
            <div key={grp.provider}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide">
                {grp.label}
              </DropdownMenuLabel>
              {grp.items.map((e) => {
                const name = e.model ?? e.name;
                const st = reach[e.id];
                const checking = st === "checking";
                const unreachable = st === "fail";
                // 不可连通：置灰禁用，onSelect 不触发
                const disabled = unreachable;
                return (
                  <DropdownMenuItem
                    key={e.id}
                    disabled={disabled}
                    onSelect={(ev) => {
                      if (disabled) {
                        ev.preventDefault();
                        return;
                      }
                      if (sid) pick.mutate(e.id);
                    }}
                    className={cn(
                      "flex-col items-start gap-0.5",
                      disabled && "opacity-50"
                    )}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      {model?.name === e.id && <span className="text-primary">●</span>}
                      <span className="truncate text-[13px] text-text">{name}</span>
                      {/* 连通态标记：检测中… / ✅ / ❌ */}
                      <span className="ml-auto flex shrink-0 items-center">
                        {checking ? (
                          <Loader2 className="h-3 w-3 animate-spin text-text-muted" />
                        ) : st === "ok" ? (
                          <CheckCircle2 className="h-3 w-3 text-success" />
                        ) : unreachable ? (
                          <XCircle className="h-3 w-3 text-error" />
                        ) : null}
                      </span>
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {checking ? "检测中…" : e.name}
                      {grp.provider !== OTHER_KEY && ` · ${grp.provider}`}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// provider 分组键 + 展示顺序（常见 provider 在前，未知/为空归到「其它」）
const OTHER_KEY = "__other__";
const PROVIDER_ORDER = ["ollama", "openai", "deepseek", "qwen", "anthropic"] as const;

/** 把 LLM 端点按 provider 分组；provider 为空归到「其它 / 默认」。 */
function groupByProvider(
  list: EndpointDto[]
): Array<{ provider: string; label: string; items: EndpointDto[] }> {
  const buckets = new Map<string, EndpointDto[]>();
  for (const e of list) {
    const key = e.provider && e.provider.trim() ? e.provider.trim() : OTHER_KEY;
    const arr = buckets.get(key);
    if (arr) arr.push(e);
    else buckets.set(key, [e]);
  }
  // 已知 provider 按预设顺序，其余按字母序，「其它」永远垫底
  const known = PROVIDER_ORDER.filter((p) => buckets.has(p));
  const extra = [...buckets.keys()]
    .filter((k) => k !== OTHER_KEY && !PROVIDER_ORDER.includes(k as any))
    .sort();
  const ordered = [...known, ...extra, ...(buckets.has(OTHER_KEY) ? [OTHER_KEY] : [])];
  return ordered.map((provider) => ({
    provider,
    label: provider === OTHER_KEY ? "其它 / 默认" : provider,
    items: buckets.get(provider)!,
  }));
}

// 占位以防未来回滚：保留连接图标 imports
const _icons = { Wifi, WifiOff, ArrowDown };
void _icons;

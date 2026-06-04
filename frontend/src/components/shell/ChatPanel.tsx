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
  MoreHorizontal,
  ChevronDown,
  Pause,
  Square,
  Paperclip,
  AtSign,
  Brain,
  Bot,
  Thermometer,
  Archive,
  ArrowDown,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSseStream } from "@/hooks/useSseStream";
import { useSessionBootstrap } from "@/hooks/useSessionBootstrap";
import { useSessionStore } from "@/stores/session";
import { useHitlStore } from "@/stores/hitl";
import { useSettingStore } from "@/stores/setting";
import { MessageStream } from "@/components/chat/MessageStream";
import { TaskProgress } from "@/components/chat/TaskProgress";
import { HitlSwitch } from "@/components/chat/HitlSwitch";
import { InlineSettingBadges } from "@/components/shell/InlineSettingBadges";
import { Button } from "@/components/ui/button";

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
  const mode = useHitlStore((s) => s.mode);
  const hydrateSetting = useSettingStore((s) => s.hydrate);
  const setChatWidth = useSettingStore((s) => s.setChatWidth);

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
      setSid(s.id);
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
      await api.send(sid, content, mode);
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
        <button className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-bg-subtle px-2.5 py-1.5">
          <span className="truncate text-[13px] font-semibold text-text">
            💬 {currentSession?.title ?? "主会话"}
          </span>
          <span
            className={cnConn(conn)}
            title={conn === "open" ? "已连接" : conn === "reconnecting" ? "重连中" : "未连接"}
          />
          <ChevronDown className="h-3 w-3 text-text-muted" />
        </button>
        <div className="flex items-center gap-0.5">
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-subtle"
            onClick={() => createSession.mutate()}
            disabled={createSession.isPending}
            title="新建会话"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-subtle"
            title="编辑（TODO）"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-subtle"
            title="删除（TODO）"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-subtle"
            title="更多（TODO）"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* HITL + 内联徽章（保留 HitlSwitch + InlineSettingBadges 三档） */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        {sid ? (
          <InlineSettingBadges pid={pid} sid={sid} />
        ) : (
          <span className="text-xs text-text-muted">建立会话中…</span>
        )}
        <HitlSwitch />
      </div>

      {/* ProgressBar：streaming 才显示，章节/计时/上下文为 C 档静态占位 */}
      {streaming && <ProgressBar />}

      {/* Task 进度（接 useTaskStore + api.tasks，B 档） */}
      <TaskProgress />

      <MessageStream />

      {/* InputArea：新动态条 + textarea + 6 工具 icon + 发送 */}
      <InputArea
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

function ProgressBar() {
  // C 档：标题 / 计时 / 上下文用量 暂为静态文案；真实接入需要后端额外字段（TODO）
  return (
    <div className="space-y-1.5 border-b border-border bg-primary-subtle px-3.5 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-primary">▶ 生成中…</span>
        <span className="flex items-center gap-2 text-xs text-text-secondary">
          <Pause className="h-3.5 w-3.5" />
          <Square className="h-3.5 w-3.5 text-error" />
        </span>
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
  sid,
  text,
  setText,
  sending,
  submit,
}: {
  sid: string | null;
  text: string;
  setText: (v: string) => void;
  sending: boolean;
  submit: () => void;
}) {
  const tools = [
    { Icon: Paperclip,  label: "上传材料（TODO）" },
    { Icon: AtSign,     label: "@ 引用工件（TODO）" },
    { Icon: Brain,      label: "思考模式（TODO）" },
    { Icon: Bot,        label: "选择 Agent（TODO）" },
    { Icon: Thermometer,label: "温度（TODO）" },
    { Icon: Archive,    label: "归档（TODO）" },
  ];

  return (
    <div className="space-y-2 border-t border-border bg-bg-elevated px-3 pb-3 pt-2.5">
      {/* 新动态条（C 档：未读消息提示静态） */}
      <div className="flex items-center justify-between rounded-md bg-[#E0F2FE] px-2.5 py-1.5 text-xs text-[#0369A1] dark:bg-[#0C2A3D] dark:text-[#7DD3FC]">
        <span>📨 — 条新动态（TODO 真实数据源）</span>
        <button className="hover:underline">查看 ›</button>
      </div>
      <div className="space-y-2 rounded-[10px] border border-border bg-bg p-2.5">
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
          placeholder={sid ? "输入消息，或 @ 引用工件 / 📎 上传材料…" : "建立会话中…"}
          className="sf-scroll w-full resize-none bg-transparent text-[13px] leading-relaxed text-text outline-none placeholder:text-text-muted"
        />
        <div className="flex items-center justify-between">
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
  );
}

// 占位以防未来回滚：保留连接图标 imports
const _icons = { Wifi, WifiOff, ArrowDown };
void _icons;

// 软件工厂缩小版 · SSE 流式订阅 hook（T-FE-02 · 六事件路由 + 重连态）
// 使用浏览器原生 EventSource，断线时浏览器自动携带 Last-Event-ID 续传。
// 注意：EventSource 走 SSE_BASE 直连后端，绕过 Next.js dev 代理对 SSE 的缓冲。
"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SSE_BASE } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { useTaskStore } from "@/stores/task";
import { useArtifactStore } from "@/stores/artifact";
import { useToolCallStore } from "@/stores/toolcall";

// SSE 七事件名（M4 P1-B 加 tool.call）
const EVENTS = [
  "message.delta",
  "message.end",
  "task.update",
  "artifact.created",
  "hitl.request",
  "stage.gate",
  "tool.call",
] as const;

export function useSseStream(sid: string | null) {
  const qc = useQueryClient();
  // 直接从 store 取稳定的 action 引用（Zustand action 引用恒定，依赖数组只需 sid）
  useEffect(() => {
    if (!sid) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    const sess = useSessionStore.getState();
    const task = useTaskStore.getState();
    const art = useArtifactStore.getState();
    const tc = useToolCallStore.getState();

    const es = new EventSource(`${SSE_BASE}/sessions/${sid}/stream`);

    const route = (type: string, data: any) => {
      switch (type) {
        case "message.delta":
          sess.appendDelta(data.msg_id, data.delta ?? "");
          break;
        case "message.end":
          sess.finalize(data.msg_id);
          // 流式结束：工件可能已生成/更新，刷新主区相关查询，使内容自动显示
          qc.invalidateQueries({ queryKey: ["artifacts"] });
          qc.invalidateQueries({ queryKey: ["artifact"] });
          qc.invalidateQueries({ queryKey: ["pending-changes"] });
          qc.invalidateQueries({ queryKey: ["rtm"] });
          break;
        case "task.update":
          task.update(data.task_id, data.status, data.progress);
          break;
        case "artifact.created":
          art.markCreated(data.artifact_url);
          // 关键修复：让 RequirementView 的工件查询失效并重新拉取，
          // 否则生成的 CRD/PRD 内容不会自动出现（需手动刷新页面）。
          qc.invalidateQueries({ queryKey: ["artifacts"] });
          qc.invalidateQueries({ queryKey: ["artifact"] });
          qc.invalidateQueries({ queryKey: ["rtm"] });
          break;
        case "hitl.request":
          sess.raiseHitl(data);
          // 待确认变更可能尚未挂到消息上：刷新 pending 列表，确保按钮实时出现
          qc.invalidateQueries({ queryKey: ["pending-changes"] });
          break;
        case "stage.gate":
          task.gate(data);
          break;
        case "tool.call":
          // 后端可附带 msg_id 关联到某条 assistant 消息；目前 _anthropic_* 未带 msg_id
          // → 落到 "_global"，ChatPanel 显示在消息流尾部。
          tc.upsert(data.msg_id, {
            id: data.id,
            name: data.name,
            status: data.status,
            duration_ms: data.duration_ms,
            tokens: data.tokens,
            hitl: data.hitl,
            input_preview: data.input_preview,
            error: data.error,
          });
          break;
      }
    };

    const handlers = EVENTS.map((t) => {
      const h = (e: MessageEvent) => {
        try {
          route(t, JSON.parse(e.data));
        } catch {
          /* 忽略坏帧 */
        }
      };
      es.addEventListener(t, h as EventListener);
      return { t, h };
    });

    es.onopen = () => useSessionStore.getState().setConnState("open");
    es.onerror = () => useSessionStore.getState().setConnState("reconnecting");

    return () => {
      handlers.forEach(({ t, h }) => es.removeEventListener(t, h as EventListener));
      es.close();
      useSessionStore.getState().setConnState("closed");
    };
  }, [sid, qc]);
}

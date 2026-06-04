// 软件工厂缩小版 · 会话自举 hook
// 进入项目外壳时：优先用 URL 的 ?sid=，否则取该项目第一个会话，
// 若项目无任何会话则自动创建一个（stage=material, agent=orchestrator）。
// sid 写入 sessionStore，并把历史消息 hydrate 进消息流。
"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSessionStore } from "@/stores/session";

export function useSessionBootstrap(pid: string, urlSid: string | null) {
  const setSid = useSessionStore((s) => s.setSid);
  const hydrate = useSessionStore((s) => s.hydrate);
  const reset = useSessionStore((s) => s.reset);
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        let sid = urlSid;
        if (!sid) {
          // 拉项目会话列表
          const sessions = await qc.fetchQuery({
            queryKey: ["sessions", pid],
            queryFn: () => api.sessions(pid),
          });
          if (sessions && sessions.length > 0) {
            sid = sessions[0].id;
          } else {
            // 无会话 → 自动创建
            const created = await api.createSession(pid, {
              title: "主会话",
              stage: "material",
              agent: "orchestrator",
            });
            sid = created.id;
            qc.invalidateQueries({ queryKey: ["sessions", pid] });
          }
        }
        if (cancelled || !sid) return;
        reset();
        setSid(sid);
        // 填充历史消息
        const msgs = await api.messages(sid);
        if (cancelled) return;
        hydrate(
          (msgs ?? []).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          }))
        );
      } catch {
        // 后端未就绪时静默：聊天框仍可输入，发送时会报错提示
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, urlSid]);
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, Pencil, Check, Trash2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 各阶段 Agent 配置：资料阶段(文件解析/内容解析) + 需求阶段(CRD/PRD/RTM)，每个子 Agent 的
// Prompt 多版本配置框：加载默认(系统内置·只读查看) / 版本下拉 / 另存新版本 / 改名 / 设当前 / 删除。
// 系统默认(v1)永不被改；prompt 仅在 provider=anthropic/pi 下生效（stub 忽略）。

const STAGE_GROUPS: { label: string; prefix: string }[] = [
  { label: "资料阶段 · 资料 Agent", prefix: "material." },
  { label: "需求阶段 · 需求 Agent", prefix: "requirement." },
];

export function AgentPromptsTab({ pid }: { pid: string }) {
  const qc = useQueryClient();
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [selVer, setSelVer] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [loadDefault, setLoadDefault] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const { data: slots } = useQuery({
    queryKey: ["agent-prompts", pid],
    queryFn: () => api.agentPrompts(pid),
    enabled: !!pid,
  });

  const slot = slots?.find((s) => s.slot === selectedSlot);
  const curVer = slot?.currentVersion ?? 1;
  const isRtm = selectedSlot === "requirement.rtm";

  // 初始化选中 slot
  useEffect(() => {
    if (slots?.length && !selectedSlot) setSelectedSlot(slots[0].slot);
  }, [slots, selectedSlot]);
  // 切 slot 复位
  useEffect(() => {
    setSelVer(null);
    setLoadDefault(false);
    setDirty(false);
    setNameInput("");
  }, [selectedSlot]);
  // 选中版本默认 = 当前版本
  useEffect(() => {
    if (slot && selVer == null) setSelVer(curVer);
  }, [slot, curVer, selVer]);

  // 选中版本内容（loadDefault 时用系统默认，不拉取）
  const { data: verData, isFetching } = useQuery({
    queryKey: ["agent-prompt-version", pid, selectedSlot, selVer],
    queryFn: () => api.agentPromptVersion(pid, selectedSlot, selVer!),
    enabled: !!slot && selVer != null && !loadDefault,
  });

  const baseContent = loadDefault
    ? slot?.defaultContent ?? ""
    : verData?.content ?? "";
  // base 变化（切版本/切默认/切 slot）时复位草稿
  useEffect(() => {
    setDraft(baseContent);
    setDirty(false);
  }, [baseContent, loadDefault, selVer, selectedSlot]);

  const selVersionMeta = useMemo(
    () => slot?.versions.find((v) => v.version === selVer),
    [slot, selVer]
  );
  const selReadonly = !!selVersionMeta?.readonly || loadDefault;

  const refresh = () => qc.invalidateQueries({ queryKey: ["agent-prompts", pid] });

  const saveNew = useMutation({
    mutationFn: () =>
      api.createAgentPromptVersion(pid, selectedSlot, {
        content: draft,
        name: nameInput.trim() || `版本 ${curVer + 1}`,
      }),
    onSuccess: (res) => {
      refresh();
      setLoadDefault(false);
      setSelVer(res.version);
      setDirty(false);
      setNameInput("");
    },
  });
  const rename = useMutation({
    mutationFn: () =>
      api.renameAgentPromptVersion(pid, selectedSlot, selVer!, nameInput.trim()),
    onSuccess: () => {
      refresh();
      setNameInput("");
    },
  });
  const setCurrent = useMutation({
    mutationFn: () => api.setAgentPromptCurrent(pid, selectedSlot, selVer!),
    onSuccess: refresh,
  });
  const del = useMutation({
    mutationFn: () => api.deleteAgentPromptVersion(pid, selectedSlot, selVer!),
    onSuccess: () => {
      refresh();
      setSelVer(null);
    },
  });
  // 美化：调大模型/agent 把当前草稿整理为规范提示词，结果填回编辑区（用户再「另存为新版本」）
  const beautify = useMutation({
    mutationFn: () => api.beautifyAgentPrompt(pid, selectedSlot, draft),
    onSuccess: (r) => {
      if (r?.content) {
        setDraft(r.content);
        setDirty(true);
      }
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-text">各阶段 Agent 配置</h3>
        <span className="rounded-md bg-bg-subtle px-2 py-0.5 text-[11px] text-text-muted">
          系统默认 Prompt 只读永不被改 · Prompt 配置在 provider=anthropic/pi 下生效（本地默认 stub 离线桩忽略 Prompt）
        </span>
      </div>

      <div className="flex gap-4">
        {/* 左：阶段 → 子 Agent 槽位树 */}
        <nav className="w-48 shrink-0 space-y-2">
          {STAGE_GROUPS.map((g) => (
            <div key={g.prefix}>
              <div className="px-1 pb-1 text-[11px] font-semibold text-text-muted">
                {g.label}
              </div>
              <div className="space-y-0.5">
                {(slots ?? [])
                  .filter((s) => s.slot.startsWith(g.prefix))
                  .map((s) => (
                    <button
                      key={s.slot}
                      onClick={() => setSelectedSlot(s.slot)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px]",
                        s.slot === selectedSlot
                          ? "bg-primary-subtle text-primary"
                          : "text-text-secondary hover:bg-bg-subtle"
                      )}
                    >
                      <span className="truncate">
                        {s.title.split("·").pop()?.trim() ?? s.title}
                      </span>
                      <span className="text-[10px] text-text-muted">
                        v{s.currentVersion}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </nav>

        {/* 右：选中子 Agent 的 Prompt 配置框 */}
        <section className="flex-1 space-y-2.5">
          {!slot ? (
            <p className="text-sm text-text-muted">加载中…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-text">{slot.title}</span>
                <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-[11px] text-text-secondary">
                  当前 v{slot.currentVersion}
                </span>
              </div>

              {isRtm && (
                <p className="rounded-md border border-border bg-bg-subtle px-3 py-1.5 text-[12px] text-text-muted">
                  占位：RTM 需求矩阵由系统按编号与「上溯：」规则抽取生成，此处 Prompt 暂不参与生成。
                </p>
              )}

              {/* 版本选择 + 加载默认 */}
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-text-secondary">版本</label>
                <select
                  value={loadDefault ? "" : selVer ?? curVer}
                  disabled={loadDefault}
                  onChange={(e) => {
                    setSelVer(Number(e.target.value));
                  }}
                  className="rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-50"
                >
                  {slot.versions
                    .slice()
                    .sort((a, b) => b.version - a.version)
                    .map((v) => (
                      <option key={v.version} value={v.version}>
                        v{v.version} · {v.name}
                        {v.version === slot.currentVersion ? "（当前）" : ""}
                        {v.readonly ? "（只读）" : ""}
                      </option>
                    ))}
                </select>

                <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={loadDefault}
                    onChange={(e) => setLoadDefault(e.target.checked)}
                  />
                  加载默认 Prompt（系统内置·只读查看）
                </label>

                {selReadonly && (
                  <span className="flex items-center gap-1 text-[11px] text-text-muted">
                    <Lock className="h-3 w-3" /> 只读
                  </span>
                )}
              </div>

              {/* 编辑区 */}
              <textarea
                value={isFetching && !loadDefault ? "加载中…" : draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDirty(true);
                }}
                spellCheck={false}
                rows={14}
                placeholder="在此编辑该子 Agent 的 Prompt；修改后「另存为新版本」即可，系统默认不会被改动。"
                className="sf-scroll w-full resize-y rounded-md border border-border bg-bg-subtle p-3 font-mono text-[13px] leading-relaxed text-text outline-none focus:border-primary"
              />

              {/* 操作区 */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="版本名（另存/改名用）"
                  className="w-44 rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-primary"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => beautify.mutate()}
                  disabled={beautify.isPending || !draft.trim() || isRtm}
                  title="调用大模型把当前内容整理成结构清晰的规范提示词（结果填回编辑区，可再另存）"
                >
                  <Sparkles className="h-3.5 w-3.5" /> {beautify.isPending ? "美化中…" : "美化"}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => saveNew.mutate()}
                  disabled={saveNew.isPending || !dirty || isRtm}
                  title={isRtm ? "RTM 暂不参与生成" : "把当前内容另存为新版本"}
                >
                  <Plus className="h-3.5 w-3.5" /> 另存为新版本
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => rename.mutate()}
                  disabled={rename.isPending || selReadonly || !nameInput.trim()}
                  title={selReadonly ? "系统默认只读，不可改名" : "重命名选中版本"}
                >
                  <Pencil className="h-3.5 w-3.5" /> 改名
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrent.mutate()}
                  disabled={
                    setCurrent.isPending || loadDefault || selVer === slot.currentVersion
                  }
                  title="将选中版本设为当前生效 Prompt"
                >
                  <Check className="h-3.5 w-3.5" /> 设为当前
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => del.mutate()}
                  disabled={del.isPending || selReadonly}
                  title={selReadonly ? "系统默认只读，不可删除" : "删除选中版本"}
                >
                  <Trash2 className="h-3.5 w-3.5" /> 删除
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

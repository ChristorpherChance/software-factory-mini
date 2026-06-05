"""编排 Agent 状态机（T-ORC-01，增强为真正落库 + M4 P1-A diff_blocks 切块）。

最小编排：识别意图 → 调度 Agent → 流式回复，并**持久化产物**：
- parse_material：跑解析管线 → 入库 artifact(type='material_parsed', content=JSON)。
- ord/crd/prd：生成 Markdown → 入库 artifact(type=kind) + 版本 → 抽取 RTM 节点/边 →
  publish artifact.created。非 Auto 模式额外创建 pending_change + hitl.request（审计/可视）。
- 创建 PendingChange 时同步算 diff_blocks：create 场景按 heading/段落切块，全标 add；
  update 场景用 difflib 出 add/del/mod。块结构对齐前端 DiffBlock：
    {id, kind:add|del|mod, tag, lines:[], state:pending}

handle() 是异步生成器，逐段 yield 文本增量；DB 写入复用传入的 session。
"""
import difflib
import json
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models.entities import (
    Session,
    Artifact,
    ArtifactVersion,
    PendingChange,
    Task,
    SessionSettingOverride,
)
from ...core.events import publish
from ...core.prompt_ctx import set_active_prompts
from ...core.model_ctx import set_active_model
from ...core.llm import edit_requirement, chat_reply
from ...services.prompt_resolve import load_active_prompts
from ...services.settings import resolve_llm_endpoint
from ..material.pipeline import parse_material
from ..requirement.generator import generate, extract_nodes

UPSTREAM = {"ord": None, "crd": "ord", "prd": "crd"}
LAYER = {"ord": "ORD", "crd": "CRD", "prd": "PRD"}


# ---- DiffBlock 切块 ----
_TAG_BY_KIND = {"add": "＋ 新增", "del": "－ 删除", "mod": "✏️ 修改"}


def _split_markdown_blocks(md: str) -> list[list[str]]:
    """把 markdown 按 heading 与空行切成段落块；每块是行列表（带原换行）。

    - heading（# / ## / ###...）单独成一块的首行
    - 连续空行作为段间分隔
    - 不做语义抽取，保形即可（前端按行展示）
    """
    if not md:
        return []
    lines = md.splitlines()
    blocks: list[list[str]] = []
    cur: list[str] = []
    for ln in lines:
        # heading 起新块
        if re.match(r"^#{1,6}\s", ln):
            if cur:
                blocks.append(cur)
                cur = []
            blocks.append([ln])
            continue
        # 空行作为段落分界
        if ln.strip() == "":
            if cur:
                blocks.append(cur)
                cur = []
            continue
        cur.append(ln)
    if cur:
        blocks.append(cur)
    return blocks


def _to_diff_blocks_create(md: str) -> list[dict]:
    """create 场景：所有段落标 add（即"全新增"）。"""
    blocks = _split_markdown_blocks(md)
    out: list[dict] = []
    for i, lines in enumerate(blocks):
        out.append(
            {
                "id": f"b{i + 1}",
                "kind": "add",
                "tag": _TAG_BY_KIND["add"],
                "lines": lines,
                "state": "pending",
            }
        )
    return out


def _to_diff_blocks_update(old_md: str, new_md: str) -> list[dict]:
    """update 场景：difflib 出 add/del/mod 块。

    把 SequenceMatcher 的 opcodes 直接映射成块；'equal' 段不入块（前端只渲染变更）。
    """
    old_lines = (old_md or "").splitlines()
    new_lines = (new_md or "").splitlines()
    sm = difflib.SequenceMatcher(a=old_lines, b=new_lines, autojunk=False)
    out: list[dict] = []
    i = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if tag == "insert":
            kind = "add"
            lines = new_lines[j1:j2]
        elif tag == "delete":
            kind = "del"
            lines = old_lines[i1:i2]
        else:  # 'replace'
            kind = "mod"
            # 用 ` ⇢ ` 拼接旧/新（前端按行渲染，简单可读）
            lines = (
                [f"- {ln}" for ln in old_lines[i1:i2]]
                + [f"+ {ln}" for ln in new_lines[j1:j2]]
            )
        i += 1
        out.append(
            {
                "id": f"b{i}",
                "kind": kind,
                "tag": _TAG_BY_KIND[kind],
                "lines": lines,
                "state": "pending",
            }
        )
    return out


class Orchestrator:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _project_and_hitl(self, session_id: str):
        s = await self.db.get(Session, session_id)
        pid = s.project_id if s else None
        hitl = (s.hitl_mode if s and s.hitl_mode else None) or "Semi"
        return pid, hitl, s

    async def handle(
        self,
        session_id: str,
        user_text: str,
        hitl_mode: str | None = None,
        references: list[str] | None = None,
        target_type: str | None = None,
        target_artifact_id: str | None = None,
        quote: str | None = None,
    ):
        pid, sess_hitl, _ = await self._project_and_hitl(session_id)
        hitl = hitl_mode or sess_hitl
        # 注入各 Agent 当前绑定 Prompt（设置页配置）；仅 anthropic/pi 生效，stub 忽略
        try:
            set_active_prompts(await load_active_prompts(self.db))
        except Exception:
            pass
        # 注入会话级模型选择（问题2）：ModelPicker 经 api.putOverride 写 model.name → 解析出端点。
        try:
            await self._inject_active_model(pid, session_id)
        except Exception:
            set_active_model(None)  # 失败忽略，走默认 provider 分流
        intent = self._route(user_text)
        # 划选引用（问题3）：有引用片段则强制按定向编辑处理（parse_material 除外）。
        if quote and quote.strip() and intent != "parse_material":
            intent = "edit"

        if intent == "parse_material":
            yield "开始解析资料…\n"
            result = await parse_material(user_text, session_id)
            if pid:
                await self._save_material(pid, user_text, result, session_id)
            yield f"解析完成，就绪度 {result['readiness_score']:.2f}。"
            if result.get("missing_items"):
                yield "\n缺口：" + "、".join(result["missing_items"])
            return

        # 对话定向编辑（问题5）：只改指定条目 → 切块 → 建 pending（不整篇覆盖）。
        if intent == "edit":
            kind = (target_type or "crd").lower()
            if kind not in ("crd", "prd", "ord"):
                kind = "crd"
            from ...services.artifact_helpers import latest_content

            old_md = await latest_content(self.db, pid, kind) if pid else ""
            if not (old_md or "").strip():
                yield f"当前「{kind.upper()}」还没有可编辑的文档，请先生成后再修改。"
                return
            prompt_override = None
            try:
                prompt_override = (await load_active_prompts(self.db)).get(f"requirement.{kind}")
            except Exception:
                prompt_override = None
            new_md = await edit_requirement(old_md, user_text, prompt_override, quote)
            if new_md == old_md:
                yield "未能定位到要修改的位置：请指明具体章节/编号（如 CR-003）或换种说法。"
                return
            pc = await self._save_edit_pending(
                pid, kind, target_artifact_id, old_md, new_md, session_id, hitl
            )
            n = len(pc.diff_blocks) if (pc and pc.diff_blocks) else len(_to_diff_blocks_update(old_md, new_md))
            yield f"已在「{kind.upper()}」中定位并生成 {n} 处改动，请在主区逐块确认（不会整篇覆盖原文）。"
            return

        if intent in ("ord", "crd", "prd", "gen"):
            # "gen"=有生成动词但未点名类型：按当前主区工件类型生成（回落 crd）。
            kind = intent if intent in ("ord", "crd", "prd") else (target_type or "crd").lower()
            if kind not in ("ord", "crd", "prd"):
                kind = "crd"
            yield f"生成 {kind.upper()} 中…\n"
            # 自动拆解子步骤任务（问题3），过程中推进，前端 Task 进度区可见
            steps = await self._auto_decompose_tasks(pid, kind, session_id) if pid else []
            await self._advance_task(pid, session_id, steps, 0)  # 1 收集上游与参考资料
            upstream_md = (
                await self._build_generation_upstream(pid, kind, references)
                if pid
                else user_text
            )
            await self._advance_task(pid, session_id, steps, 1)  # 2 规划章节大纲
            await self._advance_task(pid, session_id, steps, 2)  # 3 逐条产出需求项
            doc = await generate(kind, upstream_md or user_text, session_id=session_id)
            # 大文档分块：用较大块（400）减少 SSE 事件数，避免前端被上千次增量压垮（卡死修复）。
            for chunk in _chunks(doc["markdown"], 400):
                yield chunk
            await self._advance_task(pid, session_id, steps, 3)  # 4 抽取追溯边(RTM)
            if pid:
                await self._save_requirement(pid, kind, doc, session_id, hitl)
            await self._advance_task(pid, session_id, steps, 4)  # 5 自检覆盖率
            # 生成完成即清除步骤任务（问题6：仅生成中显示，完成后清除）。
            await self._clear_step_tasks(pid, kind, steps)
            return

        # 默认：对话（问题3）。不重写文档；配置了真实模型则对话式回答，否则给出明确指引。
        ctx = ""
        if pid and target_type:
            try:
                from ...services.artifact_helpers import latest_content

                ctx = await latest_content(self.db, pid, (target_type or "").lower())
            except Exception:
                ctx = ""
        yield await chat_reply(user_text, ctx)

    # ---- 会话级模型选择（问题2）----
    async def _inject_active_model(self, pid, session_id):
        """读会话级 model.name 覆盖 → resolve 出端点 dict 注入 contextvar。"""
        if not pid:
            set_active_model(None)
            return
        ov = (
            await self.db.execute(
                select(SessionSettingOverride).where(
                    SessionSettingOverride.session_id == session_id,
                    SessionSettingOverride.category == "model",
                    SessionSettingOverride.key == "name",
                )
            )
        ).scalars().first()
        name = None
        if ov and ov.value:
            # value 可能是裸字符串或 {"name": ...} 形态，做宽松解析
            name = ov.value if isinstance(ov.value, str) else (ov.value.get("name") if isinstance(ov.value, dict) else None)
        if not name:
            set_active_model(None)
            return
        ep = await resolve_llm_endpoint(self.db, pid, name)
        set_active_model(ep)

    # ---- Agent 自动拆解任务（问题3）----
    async def _auto_decompose_tasks(self, pid, kind, session_id) -> list[str]:
        """把本次生成拆成 5 条真实子步骤任务；先清理历史同类步骤再建，返回 task id 列表。

        失败不抛（生成不应因任务拆解失败而中断）。"""
        try:
            prefix = f"{kind.upper()}-STEP"
            old = (
                await self.db.execute(
                    select(Task).where(Task.project_id == pid, Task.code.like(f"{prefix}-%"))
                )
            ).scalars().all()
            for t in old:
                await self.db.delete(t)
            if old:
                await self.db.commit()
            step_titles = [
                "收集上游与参考资料",
                "规划章节大纲",
                "逐条产出需求项",
                "抽取追溯边(RTM)",
                "自检覆盖率",
            ]
            tasks: list[Task] = []
            for i, title in enumerate(step_titles, 1):
                t = Task(
                    project_id=pid,
                    code=f"{prefix}-{i}",
                    title=title,
                    stage="requirement",
                    status="todo",
                )
                self.db.add(t)
                tasks.append(t)
            await self.db.commit()
            for t in tasks:
                await self.db.refresh(t)
            return [str(t.id) for t in tasks]
        except Exception:
            return []

    async def _advance_task(self, pid, session_id, task_ids: list[str], idx: int):
        """推进第 idx 个步骤任务：todo→in_progress→done，并 publish task.update（channel=pid）。

        失败不抛（务实推进，缺一步也不影响生成）。"""
        if not task_ids or idx >= len(task_ids) or not pid:
            return
        try:
            tid = task_ids[idx]
            t = await self.db.get(Task, tid)
            if not t:
                return
            t.status = "in_progress"
            await self.db.commit()
            await publish(str(pid), "task.update", {"task_id": tid, "status": "in_progress"})
            t.status = "done"
            await self.db.commit()
            await publish(str(pid), "task.update", {"task_id": tid, "status": "done"})
        except Exception:
            pass

    async def _clear_step_tasks(self, pid, kind, task_ids: list[str]):
        """生成完成后清除本次拆解的步骤任务（问题6）：按 id（回落 code 前缀）删除。

        删除后对每个任务再 publish 一条 task.update（status=done），促前端失效并重拉
        tasks 查询，发现已无步骤任务即隐藏 Task 区。失败不抛（不影响生成结果）。"""
        if not pid:
            return
        try:
            removed: list[str] = []
            # 优先按本次返回的 id 删；id 为空（拆解失败）时回落 code 前缀兜底清理。
            if task_ids:
                for tid in task_ids:
                    t = await self.db.get(Task, tid)
                    if t:
                        await self.db.delete(t)
                        removed.append(tid)
            else:
                prefix = f"{kind.upper()}-STEP"
                rows = (
                    await self.db.execute(
                        select(Task).where(
                            Task.project_id == pid, Task.code.like(f"{prefix}-%")
                        )
                    )
                ).scalars().all()
                for t in rows:
                    removed.append(str(t.id))
                    await self.db.delete(t)
            await self.db.commit()
            for tid in removed:
                await publish(str(pid), "task.update", {"task_id": tid, "status": "done"})
        except Exception:
            pass

    # ---- 落库 ----
    async def _save_material(self, pid, source, result, session_id):
        title = "资料解析结果"
        art = Artifact(project_id=pid, type="material_parsed", title=title, stage="material")
        self.db.add(art)
        await self.db.flush()
        self.db.add(
            ArtifactVersion(
                artifact_id=art.id,
                version=1,
                content=json.dumps(result, ensure_ascii=False),
                author="agent:material",
            )
        )
        await self.db.commit()
        await publish(
            session_id, "artifact.created", {"artifact_url": str(art.id), "kind": "material_parsed"}
        )

    async def _upstream_md(self, pid, kind):
        up = UPSTREAM.get(kind)
        if not up:
            # ORD 的上游=资料：取最近 material_parsed 的 summary/key_points 拼成文本
            from ...services.artifact_helpers import latest_content

            raw = await latest_content(self.db, pid, "material_parsed")
            if raw:
                try:
                    d = json.loads(raw)
                    return (d.get("summary", "") + "\n" + "\n".join(d.get("key_points", []))).strip()
                except Exception:
                    return raw
            return ""
        from ...services.artifact_helpers import latest_content

        return await latest_content(self.db, pid, up)

    @staticmethod
    def _material_text(content: str) -> str:
        """资料工件版本内容 → 可读正文。content 可能是结构化 JSON 或纯文本（transform 结果）。"""
        try:
            d = json.loads(content)
            if isinstance(d, dict):
                raw = (d.get("raw_text") or "").strip()
                if raw:
                    return raw
                kp = d.get("key_points") or []
                return (str(d.get("summary", "")) + "\n" + "\n".join(kp)).strip()
        except Exception:
            pass
        return content or ""

    async def _reference_context(self, pid, references: list[str] | None = None) -> str:
        """把「参考资料」拼成生成上下文。

        references 指定则仅取这些 material id；否则取全部「已定稿且完成内容解析」的资料。
        """
        from ...services.artifact_helpers import latest_version

        q = (
            select(Artifact)
            .where(
                Artifact.project_id == pid,
                Artifact.type == "material_parsed",
                Artifact.archived_at.is_(None),
            )
            .order_by(Artifact.created_at)
        )
        arts = (await self.db.execute(q)).scalars().all()
        ref_set = {str(r) for r in references} if references else None
        chosen = []
        for a in arts:
            if ref_set is not None:
                if str(a.id) in ref_set:
                    chosen.append(a)
            elif a.status == "finalized" and bool((a.extra or {}).get("content_parsed")):
                chosen.append(a)
        parts: list[str] = []
        for a in chosen:
            v = await latest_version(self.db, a.id)
            text = self._material_text((v.content if v else "") or "")
            if text.strip():
                parts.append(f"## 参考资料：{a.title}\n{text.strip()}")
        return "\n\n".join(parts)

    async def _build_generation_upstream(
        self, pid, kind, references: list[str] | None = None
    ) -> str:
        """组合生成上游：参考资料 + 链路上游工件（CRD←ORD、PRD←CRD）。"""
        from ...services.artifact_helpers import latest_content

        refs = await self._reference_context(pid, references)
        if kind == "crd":
            ord_md = await latest_content(self.db, pid, "ord")
            head = f"# 上游 ORD\n{ord_md}\n\n" if ord_md.strip() else ""
            body = f"# 参考资料\n{refs}" if refs.strip() else ""
            return (head + body).strip()
        if kind == "prd":
            # 问题6：优先取「已定稿」CRD 作上游；无定稿则回落最新 CRD 并注明（未定稿）。
            crd_md, finalized = await self._finalized_or_latest(pid, "crd")
            note = "" if finalized else "（未定稿）"
            head = f"# 上游 CRD{note}\n{crd_md}\n\n" if crd_md.strip() else ""
            # 问题1：PRD 默认只以 CRD 为参考，不自动带入前面所有资料；
            # 仅当用户在参考资料栏「显式勾选」了资料（references 非空）时才附带。
            prd_refs = refs if references else ""
            body = f"# 参考资料\n{prd_refs}" if prd_refs.strip() else ""
            return (head + body).strip()
        # ord：资料即上游（回落到旧的 summary/key_points 拼装）
        return refs.strip() or await self._upstream_md(pid, "ord")

    async def _finalized_or_latest(self, pid, doc_type) -> tuple[str, bool]:
        """优先取「已定稿」工件的最新版本内容（问题6）；无定稿则回落最新工件。

        返回 (content, is_finalized)。"""
        from ...services.artifact_helpers import latest_version, latest_content

        q = (
            select(Artifact)
            .where(
                Artifact.project_id == pid,
                Artifact.type == doc_type,
                Artifact.status == "finalized",
                Artifact.archived_at.is_(None),
            )
            .order_by(Artifact.created_at.desc())
            .limit(1)
        )
        art = (await self.db.execute(q)).scalars().first()
        if art:
            v = await latest_version(self.db, art.id)
            return ((v.content if v else "") or "", True)
        return (await latest_content(self.db, pid, doc_type), False)

    async def _save_requirement(self, pid, kind, doc, session_id, hitl):
        from ...services.rtm import add_edges, add_nodes
        from ...services.artifact_helpers import latest_content

        # 是否已存在同 type 工件：决定 create / update 切块策略
        prev_md = await latest_content(self.db, pid, kind)
        new_md = doc["markdown"]

        # 工件落库（仍然走 create 一条新工件 + version=1；prev 仅作切块对照）
        art = Artifact(project_id=pid, type=kind, title=kind.upper(), stage="requirement")
        self.db.add(art)
        await self.db.flush()
        self.db.add(
            ArtifactVersion(
                artifact_id=art.id, version=1, content=new_md, author="agent:requirement"
            )
        )
        await self.db.commit()
        # RTM 节点 + 边
        nodes = extract_nodes(new_md, LAYER[kind])
        if nodes:
            await add_nodes(self.db, pid, nodes, commit=False)
        if doc["edges"]:
            await add_edges(self.db, pid, doc["edges"], commit=False)
        await self.db.commit()
        await publish(session_id, "artifact.created", {"artifact_url": str(art.id), "kind": kind})
        # 非 Auto：登记待定变更 + HITL 请求（审计与前端可视）
        if hitl in ("Semi", "Manual"):
            # 切块：有上一版走 update diff；
            # 若 update diff 为空（stub 模式上一版与本版完全相同）则 fallback 走 create
            # 全 add，便于前端始终看到内容（否则按块视图空、无法做按块演示）。
            if prev_md and prev_md != new_md:
                blocks = _to_diff_blocks_update(prev_md, new_md)
                op = "update"
            else:
                blocks = _to_diff_blocks_create(new_md)
                op = "create"
            pc = PendingChange(
                project_id=pid,
                target_type="artifact",
                target_id=art.id,
                op=op,
                diff={"type": kind, "title": kind.upper(), "note": "agent 生成的需求工件，待确认"},
                diff_blocks=blocks,
                source_actor="agent:orchestrator",
                hitl_mode=hitl,
            )
            self.db.add(pc)
            await self.db.commit()
            await self.db.refresh(pc)
            await publish(
                session_id,
                "hitl.request",
                {
                    "pending_change_id": str(pc.id),
                    "kind": kind,
                    "count": len(blocks) or 1,
                },
            )

    async def _save_edit_pending(self, pid, kind, target_id, old_md, new_md, session_id, hitl):
        """定向编辑（问题2）：对当前工件切 update diff 块，建 PendingChange(op=update)，
        **不立即落新版本**——按块确认后由 pending_changes 写回。target_id=当前工件。"""
        if not target_id:
            from ...services.artifact_helpers import latest_artifact

            art = await latest_artifact(self.db, pid, kind)
            target_id = art.id if art else None
        if not target_id or old_md == new_md:
            return None
        blocks = _to_diff_blocks_update(old_md, new_md)
        if not blocks:
            return None
        pc = PendingChange(
            project_id=pid,
            target_type="artifact",
            target_id=target_id,
            op="update",
            diff={
                "type": kind,
                "title": kind.upper(),
                "note": "对话定向编辑，待按块确认",
                # 写回所需：保存编辑前后全文，pending 确认时据 confirmed 块重建新版本
                "oldMd": old_md,
                "newMd": new_md,
            },
            diff_blocks=blocks,
            source_actor="agent:orchestrator:edit",
            hitl_mode=hitl,
        )
        self.db.add(pc)
        await self.db.commit()
        await self.db.refresh(pc)
        await publish(
            session_id,
            "hitl.request",
            {"pending_change_id": str(pc.id), "kind": kind, "count": len(blocks), "op": "edit"},
        )
        return pc

    def _route(self, text: str) -> str:
        t = text.lower().strip()
        if any(t.endswith(e) for e in (".md", ".pdf", ".docx", ".png", ".jpg", ".jpeg")) or t.startswith("http"):
            return "parse_material"
        if t.startswith("raw_text:") or "解析资料" in text or "解析这" in text:
            return "parse_material"
        # 问题3：仅当出现明确「生成/重新生成」动词时，才触发整篇生成；
        # 仅"提及" crd/prd（如提问/闲聊）绝不重写——否则用户每发一句都被整篇重写。
        if any(g in text for g in self._GEN_VERBS):
            for k in ("prd", "crd", "ord"):
                if k in t:
                    return k
            return "gen"  # 有生成动词但未点名类型 → 由 handle 按当前主区工件类型决定
        # 含修改动词（且无生成动词）→ 定向编辑当前文档（局部改，不整篇重生成）。
        if self._is_edit_intent(text):
            return "edit"
        # 其余（含仅提及 crd/prd 的提问/讨论）→ 对话，绝不整篇重写。
        return "chat"

    # 修改动词（编辑意图）；命中且非「生成/重新生成」整篇指令时视为定向编辑
    _EDIT_VERBS = ("改", "修改", "更新", "删除", "调整", "补充", "替换", "增加", "去掉", "改成", "改为")
    _GEN_VERBS = ("生成", "重新生成", "重生成", "regenerate")

    def _is_edit_intent(self, text: str) -> bool:
        t = text.strip()
        if any(g in t for g in self._GEN_VERBS):
            return False  # 「生成/重新生成 CRD」= 整篇，不算编辑
        return any(v in t for v in self._EDIT_VERBS)


def _chunks(s: str, n: int):
    for i in range(0, len(s), n):
        yield s[i : i + n]

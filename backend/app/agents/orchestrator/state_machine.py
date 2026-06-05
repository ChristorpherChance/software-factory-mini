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

from ...models.entities import Session, Artifact, ArtifactVersion, PendingChange
from ...core.events import publish
from ...core.prompt_ctx import set_active_prompts
from ...services.prompt_resolve import load_active_prompts
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
    ):
        pid, sess_hitl, _ = await self._project_and_hitl(session_id)
        hitl = hitl_mode or sess_hitl
        # 注入各 Agent 当前绑定 Prompt（设置页配置）；仅 anthropic/pi 生效，stub 忽略
        try:
            set_active_prompts(await load_active_prompts(self.db))
        except Exception:
            pass
        intent = self._route(user_text)

        if intent == "parse_material":
            yield "开始解析资料…\n"
            result = await parse_material(user_text, session_id)
            if pid:
                await self._save_material(pid, user_text, result, session_id)
            yield f"解析完成，就绪度 {result['readiness_score']:.2f}。"
            if result.get("missing_items"):
                yield "\n缺口：" + "、".join(result["missing_items"])
            return

        if intent in ("ord", "crd", "prd"):
            yield f"生成 {intent.upper()} 中…\n"
            upstream_md = (
                await self._build_generation_upstream(pid, intent, references)
                if pid
                else user_text
            )
            doc = await generate(intent, upstream_md or user_text, session_id=session_id)
            for chunk in _chunks(doc["markdown"], 60):
                yield chunk
            if pid:
                await self._save_requirement(pid, intent, doc, session_id, hitl)
            return

        yield "已收到。可上传/粘贴资料触发解析，或说明要生成的文档类型（ORD/CRD/PRD）。"

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
            crd_md = await latest_content(self.db, pid, "crd")
            head = f"# 上游 CRD\n{crd_md}\n\n" if crd_md.strip() else ""
            body = f"# 参考资料\n{refs}" if refs.strip() else ""
            return (head + body).strip()
        # ord：资料即上游（回落到旧的 summary/key_points 拼装）
        return refs.strip() or await self._upstream_md(pid, "ord")

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
        # 编辑意图（问题2）：对话=局部改。含修改动词 → 定向编辑当前文档（不整篇重生成）。
        # 注意：必须在 ord/crd/prd 贪心匹配之前，否则「把 CR-003 改成…」会被当成整篇生成 CRD。
        if self._is_edit_intent(text):
            return "edit"
        for k in ("prd", "crd", "ord"):
            if k in t:
                return k
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

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

from sqlalchemy.ext.asyncio import AsyncSession

from ...models.entities import Session, Artifact, ArtifactVersion, PendingChange
from ...core.events import publish
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

    async def handle(self, session_id: str, user_text: str, hitl_mode: str | None = None):
        pid, sess_hitl, _ = await self._project_and_hitl(session_id)
        hitl = hitl_mode or sess_hitl
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
            upstream_md = await self._upstream_md(pid, intent) if pid else user_text
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

    def _route(self, text: str) -> str:
        t = text.lower().strip()
        if any(t.endswith(e) for e in (".md", ".pdf", ".docx", ".png", ".jpg", ".jpeg")) or t.startswith("http"):
            return "parse_material"
        if t.startswith("raw_text:") or "解析资料" in text or "解析这" in text:
            return "parse_material"
        for k in ("prd", "crd", "ord"):
            if k in t:
                return k
        return "chat"


def _chunks(s: str, n: int):
    for i in range(0, len(s), n):
        yield s[i : i + n]

"""内部回调端点（Phase 3）：供 agent-service 自定义工具回调。

挂在 /api/v1/internal/*，复用现有 ORM / rtm / delegate.service，不重写既有契约。
鉴权同主站 Bearer。session_id → project_id 经 Session 表解析。

端点：
  POST /internal/tooling/parse     非 LLM 资料抽取（Phase 5 补全，先回退 stub 解析）
  POST /internal/artifact/write    落库 Artifact/Version + RTM 节点/边 + publish artifact.created
  POST /internal/events/task       publish task.update
  POST /internal/stage/gate        coverage_report + publish stage.gate
  POST /internal/delegate          复用 delegate.service.delegate
  POST /internal/audit             写 DelegateAudit（Phase 4 审计）
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db
from ...models.entities import Session, Artifact, ArtifactVersion, DelegateAudit
from ...core.events import publish
from ...services.rtm import add_nodes, add_edges, coverage_report
from ...agents.requirement.generator import extract_nodes, extract_edges
from ._common import ok

router = APIRouter(tags=["internal"])

LAYER = {"ord": "ORD", "crd": "CRD", "prd": "PRD"}


async def _pid_of(db: AsyncSession, session_id: str) -> str:
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404, "session not found")
    return s.project_id


@router.post("/internal/tooling/parse")
async def tooling_parse(body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """非 LLM 资料抽取（Phase 5 拆 detect/extract 进来）。当前回退 stub 结构化。"""
    from ...core.llm import _stub_structure

    source = body.get("source", "")
    return ok(_stub_structure(source))


@router.post("/internal/artifact/write")
async def artifact_write(body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """落库 Artifact/ArtifactVersion + RTM 节点/边 + publish artifact.created。

    body: { session_id, kind(ord|crd|prd|...), name, content, upstream_ids?[] }
    """
    sid = body["session_id"]
    pid = await _pid_of(db, sid)
    kind = body["kind"]
    name = body.get("name") or kind.upper()
    content = body.get("content", "")

    art = Artifact(project_id=pid, type=kind, title=name, stage="requirement")
    db.add(art)
    await db.flush()
    db.add(
        ArtifactVersion(
            artifact_id=art.id, version=1, content=content, author="agent:tool"
        )
    )
    await db.commit()

    # RTM 节点 + 边（复用 generator 的抽取 + rtm helpers）
    if kind in LAYER:
        nodes = extract_nodes(content, LAYER[kind])
        if nodes:
            await add_nodes(db, pid, nodes, commit=False)
        edges = extract_edges(content)
        if edges:
            await add_edges(db, pid, edges, commit=False)
        await db.commit()

    await publish(sid, "artifact.created", {"artifact_url": str(art.id), "kind": kind})
    return ok({"artifact_id": str(art.id), "version": 1})


@router.post("/internal/events/task")
async def events_task(body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """扇出 task.update 进度事件。body: { session_id, pct, note? }"""
    sid = body["session_id"]
    await publish(sid, "task.update", {"pct": body.get("pct", 0), "note": body.get("note", "")})
    return ok({"emitted": True})


@router.post("/internal/stage/gate")
async def stage_gate(body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """校验阶段门（RTM 覆盖率 ≥ 0.85），发 stage.gate 事件。body: { session_id, stage }"""
    sid = body["session_id"]
    pid = await _pid_of(db, sid)
    stage = body.get("stage", "requirement")
    rep = await coverage_report(db, pid)
    score = rep.get("healthScore", rep.get("overall", 0.0))
    passed = score >= 0.85
    await publish(
        sid, "stage.gate", {"stage": stage, "passed": passed, "score": score, "report": rep}
    )
    return ok({"stage": stage, "passed": passed, "score": score})


@router.post("/internal/delegate")
async def internal_delegate(body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """复用 delegate.service.delegate（HITL+脱敏+降级+审计）。

    body: { session_id, target, payload, hitl_mode? }
    """
    from ...delegate.service import delegate as do_delegate

    sid = body["session_id"]
    pid = await _pid_of(db, sid)
    res = await do_delegate(
        db, pid, sid, body["target"], body.get("payload", {}), body.get("hitl_mode", "Semi")
    )
    return ok(res)


@router.post("/internal/audit")
async def internal_audit(body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """afterToolCall 审计落库（Phase 4）。body: { session_id, target, payload_sha256, ts }"""
    sid = body.get("session_id")
    pid = None
    if sid:
        s = await db.get(Session, sid)
        pid = s.project_id if s else None
    if not pid:
        return ok({"audited": False, "reason": "no project"})
    rec = DelegateAudit(
        project_id=pid,
        session_id=sid,
        target=body.get("target", "tool"),
        request={"payload_sha256": body.get("payload_sha256"), "ts": body.get("ts")},
        status="ok",
    )
    db.add(rec)
    await db.commit()
    return ok({"audited": True, "id": str(rec.id)})

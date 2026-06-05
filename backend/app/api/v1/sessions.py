"""会话 Session & 子会话 API（S2 接口设计 §3）。"""
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db
from ...models.entities import Session
from ._common import ok, paged
from ...core.errors import AppError

router = APIRouter(tags=["sessions"])


def _dto(s: Session) -> dict:
    return {
        "id": str(s.id),
        "projectId": str(s.project_id),
        "parentSessionId": str(s.parent_session_id) if s.parent_session_id else None,
        "title": s.title,
        "stage": s.stage,
        "agent": s.agent,
        "hitlMode": s.hitl_mode,
        "status": s.status,
        "createdAt": s.created_at.isoformat() if s.created_at else None,
    }


@router.post("/projects/{pid}/sessions")
async def create(pid: str, body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    s = Session(
        project_id=pid,
        title=body.get("title", "主会话"),
        stage=body.get("stage"),
        agent=body.get("agent", "orchestrator"),
        hitl_mode=body.get("hitlMode"),
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return ok(_dto(s))


@router.get("/projects/{pid}/sessions")
async def lst(
    pid: str, stage: str | None = None, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    q = select(Session).where(Session.project_id == pid, Session.archived_at.is_(None)).order_by(
        Session.created_at
    )
    if stage:
        q = q.where(Session.stage == stage)
    rows = (await db.execute(q)).scalars().all()
    return paged([_dto(s) for s in rows])


@router.get("/sessions/{sid}")
async def get_one(sid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    s = await db.get(Session, sid)
    if not s:
        raise AppError(404, "session not found")
    return ok(_dto(s))


@router.patch("/sessions/{sid}")
async def patch(sid: str, body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    s = await db.get(Session, sid)
    if not s:
        raise AppError(404, "session not found")
    for k_in, attr in (("title", "title"), ("status", "status"), ("hitlMode", "hitl_mode")):
        if k_in in body:
            setattr(s, attr, body[k_in])
    await db.commit()
    await db.refresh(s)
    return ok(_dto(s))


@router.delete("/sessions/{sid}")
async def archive(sid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """会话软删除/归档（问题5）：置 archived_at；列表已过滤 archived_at.is_(None)。

    不存在也安全返回 ok（与其它实体软删一致，幂等）。"""
    s = await db.get(Session, sid)
    if s:
        s.archived_at = func.now()
        await db.commit()
    return ok({"deleted": True})


@router.post("/sessions/{sid}/subsessions")
async def subsession(
    sid: str, body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    parent = await db.get(Session, sid)
    if not parent:
        raise AppError(404, "session not found")
    child = Session(
        project_id=parent.project_id,
        parent_session_id=parent.id,
        title=body.get("title", "子会话"),
        agent=body.get("agent"),
        delegate_ref=body.get("delegateRef"),
    )
    db.add(child)
    await db.commit()
    await db.refresh(child)
    return ok(_dto(child))

"""消息 Message API（发送 → 触发编排 → SSE 流式）。"""
import asyncio

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db, SessionLocal
from ...models.entities import Message, Session
from ...core.events import publish
from ...agents.orchestrator.state_machine import Orchestrator
from ._common import ok, paged, idem_get, idem_put

router = APIRouter(tags=["messages"])


def _dto(m: Message) -> dict:
    return {
        "id": str(m.id),
        "sessionId": str(m.session_id),
        "role": m.role,
        "content": m.content,
        "status": m.status,
        "createdAt": m.created_at.isoformat() if m.created_at else None,
    }


async def _run_orchestrator(sid: str, user_text: str, hitl_mode: str | None):
    """后台任务：独立 DB session 跑编排，逐 token publish。"""
    async with SessionLocal() as db:
        assistant = Message(session_id=sid, role="assistant", content="", status="streaming")
        db.add(assistant)
        await db.commit()
        aid = str(assistant.id)
        buf = ""
        try:
            async for delta in Orchestrator(db).handle(sid, user_text, hitl_mode):
                buf += delta
                await publish(
                    sid,
                    "message.delta",
                    {"msg_id": aid, "delta": delta, "role": "assistant"},
                )
            assistant.content, assistant.status = buf, "completed"
            await db.commit()
            await publish(sid, "message.end", {"msg_id": aid, "finish_reason": "stop"})
        except Exception as e:  # noqa: BLE001
            assistant.content = buf + f"\n[编排出错] {e}"
            assistant.status = "error"
            await db.commit()
            await publish(sid, "message.end", {"msg_id": aid, "finish_reason": "error"})


@router.post("/sessions/{sid}/messages")
async def send(
    sid: str,
    body: dict,
    idem: str | None = Header(default=None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    cached = idem_get(idem)
    if cached:
        return cached
    # 透传/记忆 HITL 档到会话
    hitl = body.get("hitlMode")
    if hitl:
        s = await db.get(Session, sid)
        if s:
            s.hitl_mode = hitl
            await db.commit()
    m = Message(
        session_id=sid,
        role="user",
        content=body["content"],
        attachments=body.get("attachments", []),
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    asyncio.create_task(_run_orchestrator(sid, body["content"], hitl))
    return idem_put(idem, ok(_dto(m)))


@router.get("/sessions/{sid}/messages")
async def lst(sid: str, limit: int = 100, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    q = select(Message).where(Message.session_id == sid).order_by(Message.created_at).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return paged([_dto(m) for m in rows], limit=limit)


@router.post("/sessions/{sid}/messages/{mid}/cancel")
async def cancel(sid: str, mid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    m = await db.get(Message, mid)
    if m and m.status == "streaming":
        m.status = "cancelled"
        await db.commit()
    return ok({"cancelled": True})

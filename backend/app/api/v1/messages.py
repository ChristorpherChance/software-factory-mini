"""消息 Message API（发送 → 触发编排 → SSE 流式）。"""
import asyncio
import json

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db, SessionLocal
from ...config import settings
from ...models.entities import Message, Session
from ...core.events import publish
from ...agents.orchestrator.state_machine import Orchestrator
from ._common import ok, paged, idem_get, idem_put

router = APIRouter(tags=["messages"])


async def _pi_ws_stream(sid: str, user_text: str, aid: str) -> str:
    """Phase 2：消费 agent-service 的 WS token 真流式，逐 token publish。

    返回聚合后的完整文本。任何异常向上抛，由调用方回落假流式（铁律#3）。
    保持 publish payload 形状 {msg_id, delta, role}，不破坏前端 SSE 契约。
    """
    import httpx
    from httpx_ws import aconnect_ws

    headers = {"Authorization": f"Bearer {settings.auth_bearer_token}"}
    # 1) 确保子会话存在（用同一 sid，agent-service 内按 sid 持有 AgentSession）
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{settings.pi_base}/sessions",
            json={"session_id": sid},
            headers=headers,
        )
        r.raise_for_status()

    # 2) WS 消费 token 流
    buf = ""
    ws_url = f"{settings.pi_ws_base}/sessions/{sid}"
    async with aconnect_ws(ws_url, headers=headers) as ws:
        await ws.send_text(json.dumps({"type": "message", "content": user_text}))
        while True:
            raw = await ws.receive_text()
            ev = json.loads(raw)
            t = ev.get("type")
            if t == "message.delta":
                delta = ev.get("text", "")
                if delta:
                    buf += delta
                    await publish(sid, "message.delta", {"msg_id": aid, "delta": delta, "role": "assistant"})
            elif t == "tool.call":
                await publish(sid, "tool.call", ev)
            elif t == "hitl.request":
                await publish(sid, "hitl.request", ev)
            elif t == "stage.gate":
                await publish(sid, "stage.gate", ev)
            elif t == "message.end":
                break
    if not buf.strip():
        raise RuntimeError("pi WS produced empty stream")
    return buf


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
    """后台任务：独立 DB session 跑编排，逐 token publish。

    provider=pi：先试 agent-service WS 真流式；失败回落本地编排假流式（铁律#3）。
    provider=stub/anthropic：走本地 Orchestrator 假流式（不变）。
    无论哪条路径，落库 + RTM + pending 由本地 Orchestrator 负责（pi 路径在 WS 后补跑薄监督器，见 Phase 3）。
    """
    async with SessionLocal() as db:
        assistant = Message(session_id=sid, role="assistant", content="", status="streaming")
        db.add(assistant)
        await db.commit()
        aid = str(assistant.id)
        buf = ""

        # Phase 2：pi 路径优先走 WS 真流式
        if settings.llm_provider == "pi":
            try:
                buf = await _pi_ws_stream(sid, user_text, aid)
                assistant.content, assistant.status = buf, "completed"
                await db.commit()
                await publish(sid, "message.end", {"msg_id": aid, "finish_reason": "stop"})
                return
            except Exception:  # noqa: BLE001
                # WS 不可达/出错 → 回落本地假流式（绝不让请求悬挂）
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

"""SSE 通道（六事件，对齐前端契约 + 骨架 §4.4）。

提供两个等价端点：
- GET /api/v1/sessions/{sid}/stream         （骨架命名）
- GET /api/v1/sessions/{sid}/messages/stream（接口设计 §4 命名）
"""
import json

from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse

from .core.events import subscribe

router = APIRouter(tags=["sse"])


def _sse_response(sid: str, last_event_id: str | None) -> StreamingResponse:
    async def gen():
        async for ev in subscribe(sid, last_event_id):
            payload = json.dumps(ev["data"], ensure_ascii=False)
            yield f"id: {ev['id']}\nevent: {ev['type']}\ndata: {payload}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.get("/sessions/{sid}/stream")
async def stream(sid: str, last_event_id: str | None = Header(default=None, alias="Last-Event-ID")):
    return _sse_response(sid, last_event_id)


@router.get("/sessions/{sid}/messages/stream")
async def stream_messages(
    sid: str, last_event_id: str | None = Header(default=None, alias="Last-Event-ID")
):
    return _sse_response(sid, last_event_id)

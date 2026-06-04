"""事件总线：派单 / SSE 扇出。

保留与 Redis Streams 版本一致的接口：
    await publish(session_id, type_, data)
    async for ev in subscribe(session_id, last_id): ...   # ev = {id, type, data}

本地默认 ``memory`` 后端（进程内异步 pub/sub + 每通道 ring buffer 支持
Last-Event-ID 续传）；设 ``EVENT_BACKEND=redis`` 可切回 Redis Streams。
"""
import asyncio
import json
import itertools
from collections import deque, defaultdict
from typing import AsyncIterator

from ..config import settings

# 七类事件（对齐前端 useSseStream + 骨架 §4.4 + M4 P1-B tool.call）
EVENTS = {
    "message.delta",
    "message.end",
    "task.update",
    "artifact.created",
    "hitl.request",
    "stage.gate",
    "tool.call",
}

_KEEPALIVE_TIMEOUT = 15.0  # 秒，无事件时发 keepalive


class _MemoryBus:
    """进程内事件总线。"""

    def __init__(self, ring: int = 1000):
        self._seq = itertools.count(1)
        self._subs: dict[str, list[asyncio.Queue]] = defaultdict(list)
        self._ring: dict[str, deque] = defaultdict(lambda: deque(maxlen=ring))

    async def publish(self, session_id: str, type_: str, data: dict) -> str:
        eid = str(next(self._seq))
        ev = {"id": eid, "type": type_, "data": data}
        self._ring[session_id].append(ev)
        for q in list(self._subs.get(session_id, [])):
            q.put_nowait(ev)
        return eid

    async def subscribe(self, session_id: str, last_id: str | None) -> AsyncIterator[dict]:
        q: asyncio.Queue = asyncio.Queue()
        self._subs[session_id].append(q)
        try:
            # Last-Event-ID 续传：回放 ring buffer 中比 last_id 更新的事件
            if last_id and last_id not in ("$", "", None):
                try:
                    after = int(last_id)
                except ValueError:
                    after = 0
                for ev in list(self._ring[session_id]):
                    if int(ev["id"]) > after:
                        yield ev
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=_KEEPALIVE_TIMEOUT)
                    yield ev
                except asyncio.TimeoutError:
                    yield {"id": last_id or "0", "type": "keepalive", "data": {}}
        finally:
            subs = self._subs.get(session_id)
            if subs and q in subs:
                subs.remove(q)


class _RedisBus:
    """Redis Streams 后端（云端可选）。"""

    def __init__(self):
        import redis.asyncio as aioredis

        self._r = aioredis.from_url(settings.redis_url, decode_responses=True)

    async def publish(self, session_id: str, type_: str, data: dict) -> str:
        return await self._r.xadd(
            f"sse:{session_id}", {"type": type_, "data": json.dumps(data)}
        )

    async def subscribe(self, session_id: str, last_id: str | None) -> AsyncIterator[dict]:
        last = last_id or "$"
        while True:
            resp = await self._r.xread({f"sse:{session_id}": last}, block=15000, count=10)
            if not resp:
                yield {"id": last, "type": "keepalive", "data": {}}
                continue
            for _stream, entries in resp:
                for eid, fields in entries:
                    last = eid
                    yield {"id": eid, "type": fields["type"], "data": json.loads(fields["data"])}


def _make_bus():
    if settings.event_backend == "redis":
        try:
            return _RedisBus()
        except Exception:  # pragma: no cover - 回落内存
            return _MemoryBus()
    return _MemoryBus()


_bus = _make_bus()


async def publish(session_id: str, type_: str, data: dict) -> str:
    return await _bus.publish(str(session_id), type_, data)


async def subscribe(session_id: str, last_id: str | None = None) -> AsyncIterator[dict]:
    async for ev in _bus.subscribe(str(session_id), last_id):
        yield ev

"""Pi 子会话委派适配器（T-DLG-03）。

真实形态：建子会话→推首条消息→拼读输出。本地无 Pi 服务时由 fallback 降级到 mock。
"""
import httpx

from .base import DelegateTarget
from ..config import settings


def _auth() -> dict:
    return {"Authorization": f"Bearer {settings.llm_api_key}"}


class PiSubsessionTarget(DelegateTarget):
    name = "pi_subsession"

    async def invoke(self, payload: dict) -> dict:
        async with httpx.AsyncClient(timeout=120) as c:
            sess = (
                await c.post(
                    f"{settings.pi_base}/sessions",
                    headers=_auth(),
                    json={"parent": payload.get("session_id")},
                )
            ).json()
            msg = await c.post(
                f"{settings.pi_base}/sessions/{sess['id']}/messages",
                headers=_auth(),
                json={"content": payload["prompt"]},
            )
            data = msg.json()
        return {"text": data.get("content", ""), "subsessionId": sess.get("id"), "raw": data}

"""通用 HTTP 委派适配器 + mock（T-DLG-05）。

endpoint 为 None 或 'mock' 时返回确定性回显，保证本地委派环路可跑通。
"""
import httpx

from .base import DelegateTarget


class GenericHttpTarget(DelegateTarget):
    name = "generic_http_agent"

    def __init__(self, endpoint: str | None = None):
        self.endpoint = endpoint

    async def invoke(self, payload: dict) -> dict:
        if not self.endpoint or self.endpoint == "mock":
            prompt = payload.get("prompt", "")
            return {"text": f"[mock] echo: {prompt[:80]}", "raw": {"mock": True}}
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(self.endpoint, json=payload)
        body = r.json()
        return {"text": body.get("output", ""), "raw": body}

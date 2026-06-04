"""真机校验：对运行中的 uvicorn 发真实 HTTP + SSE（非 ASGITransport）。

用法：先起 uvicorn，再 `python -m tests.live_check <base_url>`。
"""
import sys
import asyncio

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8128"
H = {"Authorization": "Bearer dev-single-workspace-token"}


async def main():
    async with httpx.AsyncClient(base_url=BASE, headers=H, timeout=20) as c:
        assert (await c.get("/api/v1/health")).json()["data"]["ok"]
        pid = (await c.post("/api/v1/projects", json={"name": "live"})).json()["data"]["id"]
        sid = (
            await c.post(f"/api/v1/projects/{pid}/sessions", json={"stage": "material", "hitlMode": "Auto"})
        ).json()["data"]["id"]
        print(f"project={pid[:8]} session={sid[:8]}")

        events = []

        async def listen():
            async with c.stream("GET", f"/api/v1/sessions/{sid}/stream") as r:
                ev = None
                async for line in r.aiter_lines():
                    if line.startswith("event: "):
                        ev = line[7:]
                    elif line.startswith("data: ") and ev:
                        events.append(ev)
                        if ev == "message.end":
                            return

        task = asyncio.create_task(listen())
        await asyncio.sleep(0.5)  # 确保订阅已建立
        await c.post(
            f"/api/v1/sessions/{sid}/messages",
            json={"role": "user", "content": "生成 ORD", "hitlMode": "Auto"},
        )
        try:
            await asyncio.wait_for(task, timeout=10)
        except asyncio.TimeoutError:
            pass

        from collections import Counter

        print("SSE 事件计数:", dict(Counter(events)))
        arts = (await c.get(f"/api/v1/projects/{pid}/artifacts?type=ord")).json()["data"]
        print("ORD 落库:", len(arts), "head:", arts[0]["content"].splitlines()[0] if arts else "-")

        assert "message.delta" in events, "未收到流式增量"
        assert "message.end" in events, "未收到结束事件"
        assert arts, "ORD 未落库"
    print("LIVE CHECK: PASS")


if __name__ == "__main__":
    asyncio.run(main())

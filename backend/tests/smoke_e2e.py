"""端到端冒烟（REST 轮询版，不依赖 SSE 订阅时序）。

验证完整环路：建项目→会话→资料解析→编排生成 ORD/CRD/PRD→RTM 覆盖率→自检→定稿。
用 ASGITransport 直接打 app，无需起服务器。
"""
import asyncio

from httpx import AsyncClient, ASGITransport

from app.main import app
from app.db_init import init_db

H = {"Authorization": "Bearer dev-single-workspace-token"}


async def _wait_artifact(c, pid, type_, tries=40):
    for _ in range(tries):
        lst = (await c.get(f"/api/v1/projects/{pid}/artifacts?type={type_}", headers=H)).json()["data"]
        if lst:
            return lst
        await asyncio.sleep(0.15)
    return []


async def main():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.get("/api/v1/health")).json()["data"]["ok"]
        pid = (await c.post("/api/v1/projects", headers=H, json={"name": "E2E 项目"})).json()["data"]["id"]
        sid = (
            await c.post(
                f"/api/v1/projects/{pid}/sessions",
                headers=H,
                json={"stage": "material", "hitlMode": "Auto"},
            )
        ).json()["data"]["id"]
        print("project", pid[:8], "session", sid[:8])

        mat = (
            await c.post(
                f"/api/v1/projects/{pid}/materials",
                headers=H,
                json={
                    "source": "目标：做本地软件工厂。用户是开发者。流程：上传资料生成需求。约束：本地运行。验收：跑通三件套。",
                    "isText": True,
                    "title": "demo",
                },
            )
        ).json()["data"]
        print("material readiness:", mat["readinessScore"], "quotes:", len(mat["quotes"]))
        assert 0.0 <= mat["readinessScore"] <= 1.0

        # 顺序生成 ORD→CRD→PRD：每步等上一产物落库（依赖链需串行，模拟用户逐步操作）
        for kind, type_ in (("生成 ORD", "ord"), ("生成 CRD", "crd"), ("生成 PRD", "prd")):
            await c.post(
                f"/api/v1/sessions/{sid}/messages",
                headers=H,
                json={"role": "user", "content": kind, "hitlMode": "Auto"},
            )
            lst = await _wait_artifact(c, pid, type_)
            assert lst, f"artifact {type_} not persisted"
            print(f"  artifact {type_}: v{lst[0]['currentVersion']} head={lst[0]['content'].splitlines()[0]}")

        rtm = (await c.get(f"/api/v1/projects/{pid}/rtm/report", headers=H)).json()["data"]
        print("RTM:", {k: rtm[k] for k in ("L0a", "L0b", "L0c", "healthScore", "orphans", "nodeCount", "edgeCount")})

        sc = (await c.post(f"/api/v1/projects/{pid}/selfcheck", headers=H, json={"sessionId": sid})).json()["data"]
        print("selfcheck allGreen:", sc["allGreen"], "checks:", [(x["name"], x["pass"]) for x in sc["checks"]])

        fin = (await c.post(f"/api/v1/projects/{pid}/finalize", headers=H, json={"sessionId": sid})).json()
        print("finalize:", fin.get("data") or fin)
        assert sc["allGreen"], "self-check not all green"
        assert fin["data"]["finalized"], "finalize failed"
    print("\nE2E SMOKE: PASS")


if __name__ == "__main__":
    asyncio.run(main())

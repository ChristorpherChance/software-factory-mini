"""pytest 集成测试：覆盖 M1-M3 / M-SET 关键环路。

用 ASGITransport 直打 app（每个测试独立内存 SQLite，互不污染）。
运行：python -m pytest tests/test_integration.py -q
"""
import asyncio
import json

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

H = {"Authorization": "Bearer dev-single-workspace-token"}


@pytest_asyncio.fixture
async def client():
    # DB 由 conftest 的 _reset_db 夹具按测试重建；这里只构造 ASGI 客户端
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        yield c


async def _new_project(c, name="测试项目"):
    r = await c.post("/api/v1/projects", headers=H, json={"name": name})
    return r.json()["data"]["id"]


async def _new_session(c, pid, hitl="Auto"):
    r = await c.post(
        f"/api/v1/projects/{pid}/sessions", headers=H, json={"stage": "material", "hitlMode": hitl}
    )
    return r.json()["data"]["id"]


async def _wait_artifact(c, pid, type_, tries=40):
    for _ in range(tries):
        lst = (await c.get(f"/api/v1/projects/{pid}/artifacts?type={type_}", headers=H)).json()["data"]
        if lst:
            return lst
        await asyncio.sleep(0.1)
    return []


@pytest.mark.asyncio
async def test_health(client):
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["data"]["ok"] is True


@pytest.mark.asyncio
async def test_auth_required(client):
    r = await client.get("/api/v1/projects")  # 无 Bearer
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_project_crud_and_optimistic_lock(client):
    pid = await _new_project(client)
    # 正常更新
    r = await client.patch(
        f"/api/v1/projects/{pid}", headers={**H, "If-Match": "1"}, json={"name": "改名"}
    )
    assert r.status_code == 200
    assert r.json()["data"]["version"] == 2
    # 版本冲突
    r = await client.patch(
        f"/api/v1/projects/{pid}", headers={**H, "If-Match": "1"}, json={"name": "再改"}
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "CONFLICT"


@pytest.mark.asyncio
async def test_material_parse(client):
    pid = await _new_project(client)
    r = await client.post(
        f"/api/v1/projects/{pid}/materials",
        headers=H,
        json={"source": "目标：本地软件工厂。用户：开发者。验收：跑通。", "isText": True},
    )
    d = r.json()["data"]
    assert 0.0 <= d["readinessScore"] <= 1.0
    assert isinstance(d["quotes"], list) and len(d["quotes"]) >= 1
    # 列表可见
    lst = (await client.get(f"/api/v1/projects/{pid}/materials", headers=H)).json()["data"]
    assert len(lst) == 1


@pytest.mark.asyncio
async def test_full_requirement_flow(client):
    """资料→ORD/CRD/PRD→RTM→自检→定稿 全绿。"""
    pid = await _new_project(client)
    sid = await _new_session(client, pid)
    await client.post(
        f"/api/v1/projects/{pid}/materials",
        headers=H,
        json={"source": "目标：本地软件工厂。用户：开发者。流程：解析生成。约束：本地。验收：跑通。", "isText": True},
    )
    for kind, t in (("生成 ORD", "ord"), ("生成 CRD", "crd"), ("生成 PRD", "prd")):
        await client.post(
            f"/api/v1/sessions/{sid}/messages",
            headers=H,
            json={"role": "user", "content": kind, "hitlMode": "Auto"},
        )
        assert await _wait_artifact(client, pid, t), f"{t} 未落库"

    rtm = (await client.get(f"/api/v1/projects/{pid}/rtm/report", headers=H)).json()["data"]
    assert rtm["healthScore"] >= 0.85, rtm
    assert rtm["orphans"] == [], rtm

    sc = (await client.post(f"/api/v1/projects/{pid}/selfcheck", headers=H, json={"sessionId": sid})).json()["data"]
    assert sc["allGreen"] is True, sc

    fin = (await client.post(f"/api/v1/projects/{pid}/finalize", headers=H, json={"sessionId": sid})).json()["data"]
    assert fin["finalized"] is True


@pytest.mark.asyncio
async def test_finalize_blocked_when_not_green(client):
    """未生成三件套就定稿 → 422 GATE_BLOCKED。"""
    pid = await _new_project(client)
    sid = await _new_session(client, pid)
    r = await client.post(f"/api/v1/projects/{pid}/finalize", headers=H, json={"sessionId": sid})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "GATE_BLOCKED"


@pytest.mark.asyncio
async def test_artifact_versions_and_diff(client):
    pid = await _new_project(client)
    a = (
        await client.post(
            f"/api/v1/projects/{pid}/artifacts",
            headers=H,
            json={"type": "note", "title": "n", "content": "line1\nline2"},
        )
    ).json()["data"]
    aid = a["id"]
    await client.put(
        f"/api/v1/artifacts/{aid}", headers={**H, "If-Match": "1"}, json={"content": "line1\nline2\nline3"}
    )
    diff = (await client.get(f"/api/v1/artifacts/{aid}/diff?from=1&to=2", headers=H)).json()["data"]
    assert any(ln.startswith("+line3") for ln in diff["lines"]), diff
    # 回滚
    rb = (await client.post(f"/api/v1/artifacts/{aid}/rollback", headers=H, json={"toVersion": 1})).json()["data"]
    assert rb["rolledBackTo"] == 1


@pytest.mark.asyncio
async def test_task_transitions(client):
    pid = await _new_project(client)
    await client.post(f"/api/v1/projects/{pid}/tasks", headers=H, json={"code": "T-1", "title": "任务一"})
    tasks = (await client.get(f"/api/v1/projects/{pid}/tasks", headers=H)).json()["data"]
    tid, ver = tasks[0]["id"], tasks[0]["version"]
    # 合法流转 todo->in_progress
    r = await client.post(
        f"/api/v1/tasks/{tid}/transitions", headers={**H, "If-Match": str(ver)}, json={"to": "in_progress"}
    )
    assert r.status_code == 200
    # 非法流转 in_progress->todo
    r = await client.post(
        f"/api/v1/tasks/{tid}/transitions", headers={**H, "If-Match": "2"}, json={"to": "todo"}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_pending_change_hitl(client):
    """Semi 模式生成需求 → 产生 pending_change → 批准。"""
    pid = await _new_project(client)
    sid = await _new_session(client, pid, hitl="Semi")
    await client.post(
        f"/api/v1/projects/{pid}/materials",
        headers=H,
        json={"source": "目标：x。用户：y。验收：z。", "isText": True},
    )
    await client.post(
        f"/api/v1/sessions/{sid}/messages",
        headers=H,
        json={"role": "user", "content": "生成 ORD", "hitlMode": "Semi"},
    )
    await _wait_artifact(client, pid, "ord")
    # 应有 pending_change
    for _ in range(30):
        pcs = (await client.get(f"/api/v1/projects/{pid}/pending-changes", headers=H)).json()["data"]
        if pcs:
            break
        await asyncio.sleep(0.1)
    assert pcs, "未产生待定变更"
    cid = pcs[0]["id"]
    r = await client.post(f"/api/v1/pending-changes/{cid}/approve", headers=H)
    assert r.json()["data"]["approved"] is True


@pytest.mark.asyncio
async def test_settings_endpoint_secret_masked(client):
    """端点 API Key 加密落库，列表只见 hasKey，明文不出。"""
    pid = await _new_project(client)
    await client.post(
        f"/api/v1/projects/{pid}/endpoints",
        headers=H,
        json={"kind": "llm", "name": "main", "baseUrl": "https://api.x.com", "model": "m", "apiKey": "sk-SECRET-123456"},
    )
    eps = (await client.get(f"/api/v1/projects/{pid}/endpoints", headers=H)).json()["data"]
    # 新项目会自动播种本地 Ollama 默认端点，故按名定位刚建的 "main"（不能假设 index 0）
    main = next(e for e in eps if e["name"] == "main")
    assert main["hasKey"] is True
    # 整个响应体里不应出现明文
    assert "sk-SECRET-123456" not in json.dumps(eps)


@pytest.mark.asyncio
async def test_settings_resolve_and_override(client):
    pid = await _new_project(client)
    sid = await _new_session(client, pid)
    cfg = (await client.get(f"/api/v1/projects/{pid}/settings?sid={sid}", headers=H)).json()["data"]
    assert cfg["hitl"]["mode"] in ("Auto", "Semi", "Manual")
    # 会话覆盖
    await client.put(
        f"/api/v1/projects/{pid}/sessions/{sid}/override",
        headers=H,
        json={"category": "hitl", "key": "mode", "value": "Manual"},
    )
    cfg2 = (await client.get(f"/api/v1/projects/{pid}/settings?sid={sid}", headers=H)).json()["data"]
    assert cfg2["hitl"]["mode"] == "Manual"
    # 审计有记录
    audit = (await client.get(f"/api/v1/projects/{pid}/setting-audit", headers=H)).json()["data"]
    assert len(audit) >= 1


@pytest.mark.asyncio
async def test_delegate_mock_flow(client):
    pid = await _new_project(client)
    sid = await _new_session(client, pid)
    r = await client.post(
        f"/api/v1/projects/{pid}/delegate",
        headers=H,
        json={"sessionId": sid, "target": "generic_http_agent", "payload": {"prompt": "hi"}, "hitlMode": "Auto"},
    )
    d = r.json()["data"]
    assert d["status"] == "succeeded"
    audits = (await client.get(f"/api/v1/projects/{pid}/delegate-audits", headers=H)).json()["data"]
    assert len(audits) >= 1

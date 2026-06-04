"""设置 API（M-SET · 6 类 + 端点 CRUD + 连通性测试 + 会话覆盖 + 审计 + 导入导出）。"""
import httpx
from fastapi import APIRouter, Depends, Body
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db
from ...models.entities import Endpoint, SettingAudit
from ...core.crypto import encrypt, decrypt
from ...services.settings import resolve, set_override
from ...services.settings_io import export_yaml, import_yaml
from ._common import ok, paged

router = APIRouter(tags=["settings"])


@router.get("/projects/{pid}/settings")
async def get_settings(
    pid: str, sid: str | None = None, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    return ok(await resolve(db, pid, sid))


@router.put("/projects/{pid}/sessions/{sid}/override")
async def put_override(
    pid: str, sid: str, body: dict, db: AsyncSession = Depends(get_db), user=Depends(require_auth)
):
    return ok(
        await set_override(db, sid, body["category"], body["key"], body["value"], user.get("id", "user:single"))
    )


@router.post("/projects/{pid}/endpoints")
async def create_endpoint(pid: str, body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    ep = Endpoint(
        project_id=pid,
        kind=body.get("kind", "llm"),
        name=body["name"],
        base_url=body.get("baseUrl"),
        model=body.get("model"),
        extra=body.get("extra", {}),
        api_key_cipher=encrypt(body["apiKey"]) if body.get("apiKey") else None,
    )
    db.add(ep)
    await db.commit()
    await db.refresh(ep)
    return ok({"id": str(ep.id), "name": ep.name})


@router.get("/projects/{pid}/endpoints")
async def list_endpoints(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    rows = (
        await db.execute(select(Endpoint).where(Endpoint.project_id == pid))
    ).scalars().all()
    return paged(
        [
            {
                "id": str(e.id),
                "kind": e.kind,
                "name": e.name,
                "baseUrl": e.base_url,
                "model": e.model,
                "hasKey": bool(e.api_key_cipher),
                "enabled": e.enabled,
            }
            for e in rows
        ]
    )


@router.post("/projects/{pid}/endpoints/{eid}/test")
async def test_endpoint(pid: str, eid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    ep = (await db.execute(select(Endpoint).where(Endpoint.id == eid))).scalars().first()
    if not ep:
        return ok({"reachable": False, "error": "endpoint not found"})
    key = decrypt(ep.api_key_cipher) if ep.api_key_cipher else None
    if not ep.base_url:
        return ok({"reachable": False, "error": "no base_url configured"})
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(
                f"{ep.base_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {key}"} if key else {},
            )
        return ok({"reachable": r.status_code < 500, "status": r.status_code})
    except Exception as e:  # noqa: BLE001
        return ok({"reachable": False, "error": str(e)[:120]})


@router.get("/projects/{pid}/setting-audit")
async def setting_audit(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    rows = (
        await db.execute(
            select(SettingAudit)
            .where((SettingAudit.project_id == pid) | (SettingAudit.project_id.is_(None)))
            .order_by(SettingAudit.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    return paged(
        [
            {
                "id": str(r.id),
                "category": r.category,
                "key": r.key,
                "oldValue": r.old_value,
                "newValue": r.new_value,
                "actor": r.actor,
                "createdAt": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    )


@router.get("/projects/{pid}/settings/export", response_class=PlainTextResponse)
async def export_settings(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    return await export_yaml(db, pid)


@router.post("/projects/{pid}/settings/import")
async def import_settings(
    pid: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_auth),
):
    return ok(await import_yaml(db, pid, body.get("yaml", ""), user.get("id", "user:single")))

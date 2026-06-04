"""委派 API（M2 §8）。"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db
from ...models.entities import DelegateAudit
from ...delegate.service import delegate as do_delegate_svc
from ...delegate.registry import list_targets
from ._common import ok, paged

router = APIRouter(tags=["delegate"])


@router.get("/delegate/targets")
async def targets(_=Depends(require_auth)):
    return ok({"targets": list_targets()})


@router.post("/projects/{pid}/delegate")
async def do_delegate(pid: str, body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    return ok(
        await do_delegate_svc(
            db,
            pid,
            body["sessionId"],
            body["target"],
            body["payload"],
            body.get("hitlMode", "Semi"),
        )
    )


@router.get("/projects/{pid}/delegate-audits")
async def audits(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    q = (
        select(DelegateAudit)
        .where(DelegateAudit.project_id == pid)
        .order_by(DelegateAudit.created_at.desc())
    )
    rows = (await db.execute(q)).scalars().all()
    return paged(
        [
            {
                "id": str(a.id),
                "target": a.target,
                "status": a.status,
                "latencyMs": a.latency_ms,
                "createdAt": a.created_at.isoformat() if a.created_at else None,
            }
            for a in rows
        ]
    )

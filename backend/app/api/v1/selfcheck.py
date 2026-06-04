"""自检 / 定稿 API（M3 §3）。"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db
from ...services.selfcheck_report import generate_report
from ...services.finalize import finalize_requirements
from ._common import ok

router = APIRouter(tags=["selfcheck"])


@router.post("/projects/{pid}/selfcheck")
async def selfcheck(pid: str, body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    sid = body.get("sessionId") or pid
    return ok(await generate_report(db, pid, sid))


@router.post("/projects/{pid}/finalize")
async def finalize(pid: str, body: dict, db: AsyncSession = Depends(get_db), user=Depends(require_auth)):
    sid = body.get("sessionId") or pid
    return ok(
        await finalize_requirements(
            db, pid, sid, user.get("id", "user:single"), force=body.get("force", False)
        )
    )

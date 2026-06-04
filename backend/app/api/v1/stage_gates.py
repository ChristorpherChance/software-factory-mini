"""阶段门 / 自检触发 API（S2 §8）。"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db
from ...models.entities import Project, StageGate
from ...services.selfcheck import run_stage_check
from ...core.events import publish
from ._common import ok, paged
from ...core.errors import AppError

router = APIRouter(tags=["gates"])


@router.get("/projects/{pid}/stage-gates")
async def overview(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    p = await db.get(Project, pid)
    if not p:
        raise AppError(404, "project not found")
    rows = (
        await db.execute(
            select(StageGate).where(StageGate.project_id == pid).order_by(StageGate.created_at.desc())
        )
    ).scalars().all()
    return ok(
        {
            "currentStage": p.current_stage,
            "gates": [
                {
                    "stage": g.stage,
                    "decision": g.decision,
                    "actor": g.actor,
                    "forced": g.forced,
                    "createdAt": g.created_at.isoformat() if g.created_at else None,
                }
                for g in rows
            ],
        }
    )


@router.post("/projects/{pid}/stage-gates/{stage}/check")
async def check(pid: str, stage: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    return ok(await run_stage_check(db, pid, stage))


@router.post("/projects/{pid}/stage-gates/{stage}/pass")
async def pass_gate(pid: str, stage: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    report = await run_stage_check(db, pid, stage)
    if not report["allGreen"]:
        raise AppError(422, "gate blocked: self-check not all green", "GATE_BLOCKED", report)
    p = await db.get(Project, pid)
    if not p:
        raise AppError(404, "project not found")
    p.current_stage = stage
    p.version += 1
    db.add(StageGate(project_id=pid, stage=stage, decision="passed", actor="user:single", report=report))
    await db.commit()
    await publish(pid, "stage.gate", {"from": stage, "to": stage, "score": report["score"]})
    return ok({"passed": True, "stage": stage})

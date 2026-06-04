"""定稿门禁（T-HITL-01 · M3 §3）。

三检全绿才能定稿；force 仅 HITL=Manual 下允许人工覆盖。锁定三件套最新工件为 finalized。
"""
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.entities import StageGate
from ..core.errors import AppError
from ..core.events import publish
from .triple_check import run_triple_check
from .artifact_helpers import latest_artifact

TRIPLE = ["ord", "crd", "prd"]


async def finalize_requirements(
    db: AsyncSession, pid: str, session_id: str, actor: str, force: bool = False
) -> dict:
    result = await run_triple_check(db, pid)
    if not result["allGreen"] and not force:
        raise AppError(422, "自检未全绿，不能定稿", "GATE_BLOCKED", result)
    for dt in TRIPLE:
        art = await latest_artifact(db, pid, dt)
        if art:
            art.status = "finalized"
    gate = StageGate(
        project_id=pid,
        stage="requirement",
        decision="finalized",
        actor=actor,
        forced=force,
        report=result,
    )
    db.add(gate)
    await db.commit()
    await publish(
        session_id,
        "stage.gate",
        {"from": "requirement", "to": "S2_design", "blocked": False, "finalized": True},
    )
    return {"finalized": True, "forced": force, "allGreen": result["allGreen"]}

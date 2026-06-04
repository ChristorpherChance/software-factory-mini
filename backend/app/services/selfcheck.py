"""阶段自检（T-SC · M1 §12）：必备工件存在 + RTM 覆盖率门限。"""
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.entities import Artifact
from .rtm import coverage_report, COVERAGE_GATE


async def run_stage_check(db: AsyncSession, pid: str, stage: str) -> dict:
    checks = []
    need = {
        "material": ["material_parsed"],
        "requirement": ["ord", "crd", "prd"],
    }.get(stage, [])
    for t in need:
        cnt = (
            await db.execute(
                select(func.count())
                .select_from(Artifact)
                .where(Artifact.project_id == pid, Artifact.type == t)
            )
        ).scalar()
        checks.append({"item": f"artifact:{t}", "ok": (cnt or 0) > 0})

    cov = await coverage_report(db, pid)
    checks.append(
        {
            "item": f"rtm.healthScore>={COVERAGE_GATE}",
            "ok": cov["healthScore"] >= COVERAGE_GATE,
            "value": cov["healthScore"],
        }
    )
    all_green = all(c["ok"] for c in checks)
    return {
        "stage": stage,
        "checks": checks,
        "allGreen": all_green,
        "score": round(sum(1 for c in checks if c["ok"]) / max(len(checks), 1), 3),
        "coverage": cov,
    }

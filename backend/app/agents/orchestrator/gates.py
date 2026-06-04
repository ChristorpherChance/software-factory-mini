"""通用阶段门（T-ORC-04）。"""
from sqlalchemy.ext.asyncio import AsyncSession

from ...services.selfcheck import run_stage_check
from ...core.errors import AppError
from ...core.events import publish

# 本期只开放 material/requirement 两个子阶段；其余为后续
STAGE_FLOW = ["S0", "material", "requirement", "S2_design", "S3_dev", "S4_test", "S5_release"]


async def try_advance(db: AsyncSession, pid: str, from_stage: str, to_stage: str) -> dict:
    if from_stage not in STAGE_FLOW or to_stage not in STAGE_FLOW:
        raise AppError(422, f"unknown stage {from_stage}->{to_stage}", "GATE_BLOCKED")
    i, j = STAGE_FLOW.index(from_stage), STAGE_FLOW.index(to_stage)
    if j != i + 1:
        raise AppError(422, f"non-adjacent stage hop {from_stage}->{to_stage}", "GATE_BLOCKED")
    report = await run_stage_check(db, pid, from_stage)
    if not report["allGreen"]:
        await publish(
            pid,
            "stage.gate",
            {"from": from_stage, "to": to_stage, "blocked": True, "report": report},
        )
        raise AppError(422, "stage gate blocked", "GATE_BLOCKED", report)
    await publish(pid, "stage.gate", {"from": from_stage, "to": to_stage, "blocked": False})
    return {"advanced": True, "to": to_stage, "report": report}

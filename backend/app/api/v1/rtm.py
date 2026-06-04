"""RTM API（节点+边+覆盖率报告 · S2 §8）。"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db
from ...models.entities import RtmNode, RtmEdge
from ...services.rtm import coverage_report
from ._common import ok

router = APIRouter(tags=["rtm"])


@router.get("/projects/{pid}/rtm")
async def full(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    nodes = (await db.execute(select(RtmNode).where(RtmNode.project_id == pid))).scalars().all()
    edges = (await db.execute(select(RtmEdge).where(RtmEdge.project_id == pid))).scalars().all()
    report = await coverage_report(db, pid)
    return ok(
        {
            "nodes": [
                {"id": str(n.id), "code": n.code, "layer": n.layer, "title": n.title}
                for n in nodes
            ],
            "edges": [
                {"from": str(e.from_node_id), "to": str(e.to_node_id), "relation": e.relation}
                for e in edges
            ],
            "report": report,
        }
    )


@router.get("/projects/{pid}/rtm/report")
async def report(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    return ok(await coverage_report(db, pid))


@router.post("/projects/{pid}/rtm/recompute")
async def recompute(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    return ok(await coverage_report(db, pid))

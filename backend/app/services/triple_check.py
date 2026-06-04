"""需求三件套自检：完备 / 一致 / 可测（T-SC-01 · M3 §1）。

与全局 RTM 边方向约定对齐：from=下游/子，to=上游/父。
- completeness：三件套齐备且必备章节存在（用 latest_content 读最新版本）。
- consistency：每个 PRD 节点沿 子→父 链能上溯到 ORD（无断点）。
- testability：RTM 覆盖率 overall ≥ 门限。
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.entities import RtmNode, RtmEdge
from .rtm import coverage_report, COVERAGE_GATE
from .artifact_helpers import latest_content

# 三件套必备章节（大小写/别名宽松匹配）
REQUIRED = {
    "ord": ["背景", "目标", "原始诉求"],
    "crd": ["客户需求", "验收"],
    "prd": ["功能需求", "非功能需求", "验收"],
}


async def completeness(db: AsyncSession, pid: str) -> dict:
    missing = []
    for dt, sections in REQUIRED.items():
        body = await latest_content(db, pid, dt)
        if not body:
            missing.append(f"{dt.upper()} 缺失")
            continue
        missing += [f"{dt.upper()}.{s}" for s in sections if s not in body]
    return {"name": "completeness", "pass": not missing, "missing": missing}


async def consistency(db: AsyncSession, pid: str) -> dict:
    nodes = (await db.execute(select(RtmNode).where(RtmNode.project_id == pid))).scalars().all()
    edges = (await db.execute(select(RtmEdge).where(RtmEdge.project_id == pid))).scalars().all()
    by_id = {n.id: n for n in nodes}
    # 子 → 父（from=子, to=父）
    parent = {e.from_node_id: e.to_node_id for e in edges}
    orphans = []
    for n in nodes:
        if n.layer != "PRD":
            continue
        cur, hops = n.id, 0
        while cur in parent and hops < 20:
            cur, hops = parent[cur], hops + 1
        root = by_id.get(cur)
        if not root or root.layer != "ORD":
            orphans.append(n.code)
    return {"name": "consistency", "pass": not orphans, "orphans": orphans}


async def testability(db: AsyncSession, pid: str) -> dict:
    rep = await coverage_report(db, pid)
    cov = rep.get("overall", 0.0)
    return {
        "name": "testability",
        "pass": cov >= COVERAGE_GATE,
        "coverage": cov,
        "gate": COVERAGE_GATE,
        "byLayer": rep.get("byLayer", {}),
    }


async def run_triple_check(db: AsyncSession, pid: str) -> dict:
    checks = [
        await completeness(db, pid),
        await consistency(db, pid),
        await testability(db, pid),
    ]
    return {"allGreen": all(c["pass"] for c in checks), "checks": checks}

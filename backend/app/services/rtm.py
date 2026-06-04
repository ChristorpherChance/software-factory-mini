"""RTM 服务（T-RTM：节点/边维护 + 覆盖率报告）。

边方向约定（全局统一）：from = 下游/子，to = 上游/父，relation='derives'。
覆盖率语义：层对 (up, down) 中，up 层节点若被某 down 层节点（经 from→to 边）指向，则视为已被派生覆盖。
- L0a=(ORD,CRD) L0b=(CRD,PRD) L0c=(PRD,DSG)
- 某层对的 down 层暂无节点（如本期无设计 DSG）→ 该对记 1.0 且不计入 healthScore。
返回超集，兼容 M1 selfcheck（healthScore）与 M3 triple_check（overall/byLayer）。
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.entities import RtmNode, RtmEdge

LAYER_PAIRS = {"L0a": ("ORD", "CRD"), "L0b": ("CRD", "PRD"), "L0c": ("PRD", "DSG")}
COVERAGE_GATE = 0.85


def layer_of(code: str) -> str:
    if code.startswith("PRD"):
        return "PRD"
    if code.startswith("CR"):
        return "CRD"
    if code.startswith("DSG"):
        return "DSG"
    if code.startswith("T-"):
        return "TASK"
    return "ORD"


async def upsert_node(db: AsyncSession, pid: str, code: str, layer: str, title: str | None = None):
    n = (
        await db.execute(select(RtmNode).where(RtmNode.project_id == pid, RtmNode.code == code))
    ).scalars().first()
    if not n:
        n = RtmNode(project_id=pid, code=code, layer=layer, title=title)
        db.add(n)
        await db.flush()
    elif title and not n.title:
        n.title = title
    return n


async def add_edges(db: AsyncSession, pid: str, edges: list[dict], commit: bool = True):
    for e in edges:
        src = await upsert_node(db, pid, e["from"], layer_of(e["from"]))
        tgt = await upsert_node(db, pid, e["to"], layer_of(e["to"]))
        exists = (
            await db.execute(
                select(RtmEdge).where(
                    RtmEdge.from_node_id == src.id,
                    RtmEdge.to_node_id == tgt.id,
                    RtmEdge.relation == e.get("relation", "derives"),
                )
            )
        ).scalars().first()
        if not exists:
            db.add(
                RtmEdge(
                    project_id=pid,
                    from_node_id=src.id,
                    to_node_id=tgt.id,
                    relation=e.get("relation", "derives"),
                )
            )
    if commit:
        await db.commit()


async def add_nodes(db: AsyncSession, pid: str, nodes: list[dict], commit: bool = True):
    for n in nodes:
        await upsert_node(db, pid, n["code"], n.get("layer") or layer_of(n["code"]), n.get("title"))
    if commit:
        await db.commit()


async def coverage_report(db: AsyncSession, pid: str) -> dict:
    nodes = (
        await db.execute(select(RtmNode).where(RtmNode.project_id == pid))
    ).scalars().all()
    edges = (
        await db.execute(select(RtmEdge).where(RtmEdge.project_id == pid))
    ).scalars().all()

    by_id = {n.id: n for n in nodes}
    by_layer: dict[str, list] = {}
    for n in nodes:
        by_layer.setdefault(n.layer, []).append(n)

    # 对每个上游节点，记录指向它的边其下游(from)节点所在层集合
    pointed_by_layer: dict[str, set[str]] = {}  # up_node_id -> {down_layer,...}
    for e in edges:
        frm = by_id.get(e.from_node_id)
        if frm:
            pointed_by_layer.setdefault(e.to_node_id, set()).add(frm.layer)

    by_layer_cov: dict[str, float] = {}
    included: list[float] = []
    for key, (up_layer, down_layer) in LAYER_PAIRS.items():
        ups = by_layer.get(up_layer, [])
        downs = by_layer.get(down_layer, [])
        if not ups:
            by_layer_cov[key] = 1.0  # 无上游节点 → 无待覆盖项
            continue
        if not downs:
            # 下游层尚无节点（派生未发生，如本期无设计）→ 记满分但不纳入健康分
            by_layer_cov[key] = 1.0
            continue
        covered = sum(1 for n in ups if down_layer in pointed_by_layer.get(n.id, set()))
        cov = round(covered / len(ups), 3)
        by_layer_cov[key] = cov
        included.append(cov)

    # 孤儿：ORD/CRD 层中无任何下游派生指向的节点（PRD 的下游=设计，不在本期判孤儿）
    orphans: list[str] = []
    for n in nodes:
        if n.layer in ("ORD", "CRD"):
            down_for = {"ORD": "CRD", "CRD": "PRD"}[n.layer]
            if down_for not in pointed_by_layer.get(n.id, set()):
                # 仅当对应下游层已有节点时才算孤儿（否则尚未到派生阶段）
                if by_layer.get(down_for):
                    orphans.append(n.code)

    health = round(sum(included) / len(included), 3) if included else 1.0
    return {
        "L0a": by_layer_cov["L0a"],
        "L0b": by_layer_cov["L0b"],
        "L0c": by_layer_cov["L0c"],
        "byLayer": by_layer_cov,
        "orphans": orphans,
        "healthScore": health,
        "overall": health,
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
    }

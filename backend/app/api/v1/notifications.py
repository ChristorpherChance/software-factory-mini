"""通知中心 API（M4 P2 5.1）。

端点：
- GET  /projects/{pid}/notifications?unread=true|false
- POST /projects/{pid}/notifications/{nid}/read
- POST /projects/{pid}/notifications/read-all

渠道 / 免打扰是前端 UI 偏好，不落后端。
本批 seed 一些示例通知，编排在 hitl.request / stage.gate 顺带写通知留 TODO。
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db
from ...models.entities import Notification
from ._common import ok, paged
from ...core.errors import AppError

router = APIRouter(tags=["notifications"])


def _dto(n: Notification) -> dict:
    return {
        "id": str(n.id),
        "projectId": str(n.project_id),
        "group": n.group,
        "severity": n.severity,
        "title": n.title,
        "summary": n.summary,
        "source": n.source,
        "read": bool(n.read),
        "createdAt": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("/projects/{pid}/notifications")
async def lst(
    pid: str,
    unread: bool = False,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    q = (
        select(Notification)
        .where(Notification.project_id == pid)
        .order_by(Notification.created_at.desc())
    )
    if unread:
        q = q.where(Notification.read.is_(False))
    rows = (await db.execute(q)).scalars().all()
    return paged([_dto(n) for n in rows])


@router.post("/projects/{pid}/notifications/{nid}/read")
async def mark_read(
    pid: str, nid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    n = await db.get(Notification, nid)
    if not n or str(n.project_id) != pid:
        raise AppError(404, "notification not found")
    n.read = True
    await db.commit()
    return ok({"read": True, "id": nid})


@router.post("/projects/{pid}/notifications/read-all")
async def mark_all_read(
    pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    await db.execute(
        update(Notification)
        .where(Notification.project_id == pid, Notification.read.is_(False))
        .values(read=True)
    )
    await db.commit()
    return ok({"read": True})


# ---- 简易 seed（一次性，确保前端有内容；幂等：不重复 seed） ----
_SEED_TITLE = "（示例）任务 #T-1042 等待你的确认"
_SEEDS = [
    {
        "group": "task",
        "severity": "warning",
        "title": _SEED_TITLE,
        "summary": "「拆分支付域用户故事」已进入 HITL 审核，2 处待批 pending。",
        "source": "T-1042 · 需求阶段",
    },
    {
        "group": "task",
        "severity": "success",
        "title": "（示例）任务 #T-1039 已完成",
        "summary": "Agent 已交付「订单状态机」实现并通过全部单测。",
        "source": "T-1039 · 编码阶段",
    },
    {
        "group": "stage",
        "severity": "info",
        "title": "（示例）阶段「概要设计」已开始",
        "summary": "上游需求冻结，HLD 阶段进入。",
        "source": "Pipeline · HLD",
    },
    {
        "group": "stage",
        "severity": "error",
        "title": "（示例）阶段「集成测试」失败",
        "summary": "3 个端到端用例失败，已自动回滚。",
        "source": "Pipeline · IT",
    },
    {
        "group": "artifact",
        "severity": "info",
        "title": "（示例）工件 api-spec.yaml 已更新",
        "summary": "新增 2 个端点、修改 1 个 schema。",
        "source": "Artifacts · OpenAPI",
    },
    {
        "group": "crosscut",
        "severity": "error",
        "title": "（示例）安全扫描发现高危依赖",
        "summary": "lodash@4.17.19 存在原型污染 CVE。",
        "source": "Security · SCA",
    },
    {
        "group": "system",
        "severity": "warning",
        "title": "（示例）模型预算池余额低于 15%",
        "summary": "本月「项目池」预计 2 天内触达预警阈值。",
        "source": "Billing · 预算",
    },
]


@router.post("/projects/{pid}/notifications/seed")
async def seed(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """开发辅助：seed 示例数据。幂等：已存在 _SEED_TITLE 则跳过。"""
    exists = await db.execute(
        select(Notification).where(
            Notification.project_id == pid, Notification.title == _SEED_TITLE
        )
    )
    if exists.first():
        return ok({"seeded": 0, "skipped": True})
    for s in _SEEDS:
        db.add(Notification(project_id=pid, read=False, **s))
    await db.commit()
    return ok({"seeded": len(_SEEDS)})

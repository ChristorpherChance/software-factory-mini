"""任务 Task API（状态流转 + 门禁 · S2 §6）。"""
from fastapi import APIRouter, Depends, Body
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth, if_match
from ...db import get_db
from ...models.entities import Task
from ...core.events import publish
from ._common import ok, paged, check_version
from ...core.errors import AppError

router = APIRouter(tags=["tasks"])

LEGAL = {
    "todo": {"in_progress", "cancelled"},
    "in_progress": {"blocked", "done", "cancelled"},
    "blocked": {"in_progress", "cancelled"},
    "done": set(),
    "cancelled": set(),
}


def _dto(t: Task) -> dict:
    return {
        "id": str(t.id),
        "code": t.code,
        "title": t.title,
        "stage": t.stage,
        "status": t.status,
        "assignee": t.assignee,
        "estimate": float(t.estimate) if t.estimate is not None else None,
        "version": t.version,
    }


@router.get("/projects/{pid}/tasks")
async def lst(
    pid: str, status: str | None = None, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    q = select(Task).where(Task.project_id == pid).order_by(Task.created_at)
    if status:
        q = q.where(Task.status == status)
    return paged([_dto(t) for t in (await db.execute(q)).scalars().all()])


@router.post("/projects/{pid}/tasks")
async def create(pid: str, body=Body(...), db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    items = body if isinstance(body, list) else [body]
    created = 0
    for it in items:
        db.add(
            Task(
                project_id=pid,
                code=it.get("code"),
                title=it["title"],
                stage=it.get("stage"),
                assignee=it.get("assignee"),
                estimate=it.get("estimate"),
            )
        )
        created += 1
    await db.commit()
    return ok({"created": created})


@router.get("/tasks/{tid}")
async def get_one(tid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    t = await db.get(Task, tid)
    if not t:
        raise AppError(404, "task not found")
    return ok(_dto(t))


@router.patch("/tasks/{tid}")
async def patch(
    tid: str,
    body: dict,
    im: int | None = Depends(if_match),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    t = await db.get(Task, tid)
    if not t:
        raise AppError(404, "task not found")
    check_version(t.version, im)
    for k in ("title", "assignee", "estimate", "stage"):
        if k in body:
            setattr(t, k, body[k])
    t.version += 1
    await db.commit()
    return ok(_dto(t))


@router.post("/tasks/{tid}/transitions")
async def transition(
    tid: str,
    body: dict,
    im: int | None = Depends(if_match),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    t = await db.get(Task, tid)
    if not t:
        raise AppError(404, "task not found")
    check_version(t.version, im)
    to = body["to"]
    if to not in LEGAL.get(t.status, set()):
        raise AppError(422, f"illegal transition {t.status}->{to}", "GATE_BLOCKED")
    t.status, t.version = to, t.version + 1
    await db.commit()
    await publish(str(t.project_id), "task.update", {"task_id": str(t.id), "status": to})
    return ok(_dto(t))

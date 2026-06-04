"""项目 Project API（S2 接口设计 §2）。"""
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth, if_match
from ...db import get_db
from ...models.entities import Project
from ...schemas import ProjectIn, ProjectPatch
from ._common import ok, paged, check_version
from ...core.errors import AppError

router = APIRouter(tags=["projects"])


def _dto(p: Project) -> dict:
    return {
        "id": str(p.id),
        "name": p.name,
        "description": p.description,
        "currentStage": p.current_stage,
        "hitlMode": p.hitl_mode,
        "version": p.version,
        "createdAt": p.created_at.isoformat() if p.created_at else None,
        "updatedAt": p.updated_at.isoformat() if p.updated_at else None,
    }


@router.post("/projects")
async def create(body: ProjectIn, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    p = Project(name=body.name, description=body.description)
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return ok(_dto(p))


@router.get("/projects")
async def lst(
    status: str | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    q = select(Project).where(Project.archived_at.is_(None)).order_by(Project.created_at.desc()).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return paged([_dto(p) for p in rows], limit=limit)


@router.get("/projects/{pid}")
async def get_one(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    p = await db.get(Project, pid)
    if not p:
        raise AppError(404, "project not found")
    return ok(_dto(p))


@router.patch("/projects/{pid}")
async def patch(
    pid: str,
    body: ProjectPatch,
    im: int | None = Depends(if_match),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    p = await db.get(Project, pid)
    if not p:
        raise AppError(404, "project not found")
    check_version(p.version, im)
    data = body.model_dump(exclude_none=True)
    if "current_stage" in data:
        p.current_stage = data.pop("current_stage")
    if "hitl_mode" in data:
        p.hitl_mode = data.pop("hitl_mode")
    for k, v in data.items():
        setattr(p, k, v)
    p.version += 1
    await db.commit()
    await db.refresh(p)
    return ok(_dto(p))


@router.delete("/projects/{pid}")
async def archive(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    p = await db.get(Project, pid)
    if not p:
        raise AppError(404, "project not found")
    p.archived_at = func.now()
    await db.commit()
    return ok({"archived": True})

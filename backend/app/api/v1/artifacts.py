"""工件 Artifact API（版本 / diff / 回滚 · S2 §5）。"""
import difflib

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth, if_match
from ...db import get_db
from ...models.entities import Artifact, ArtifactVersion
from ...core.events import publish
from ._common import ok, paged, check_version
from ...core.errors import AppError

router = APIRouter(tags=["artifacts"])


async def _latest_version(db: AsyncSession, aid: str) -> ArtifactVersion | None:
    q = (
        select(ArtifactVersion)
        .where(ArtifactVersion.artifact_id == aid)
        .order_by(ArtifactVersion.version.desc())
        .limit(1)
    )
    return (await db.execute(q)).scalars().first()


async def _version_content(db: AsyncSession, aid: str, v: int) -> str:
    q = select(ArtifactVersion).where(
        ArtifactVersion.artifact_id == aid, ArtifactVersion.version == v
    )
    av = (await db.execute(q)).scalars().first()
    return (av.content if av else "") or ""


async def _dto(db: AsyncSession, a: Artifact, with_content: bool = True) -> dict:
    d = {
        "id": str(a.id),
        "type": a.type,
        "title": a.title,
        "stage": a.stage,
        "status": a.status,
        "currentVersion": a.current_version,
        "version": a.version,
        "createdAt": a.created_at.isoformat() if a.created_at else None,
    }
    if with_content:
        av = await _latest_version(db, a.id)
        d["content"] = (av.content if av else "") or ""
    return d


@router.post("/projects/{pid}/artifacts")
async def create(pid: str, body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    a = Artifact(project_id=pid, type=body["type"], title=body["title"], stage=body.get("stage"))
    db.add(a)
    await db.flush()
    db.add(
        ArtifactVersion(
            artifact_id=a.id,
            version=1,
            content=body.get("content", ""),
            author=body.get("author", "agent:orchestrator"),
        )
    )
    await db.commit()
    try:
        await publish(str(pid), "artifact.created", {"artifact_url": str(a.id), "kind": a.type})
    except Exception:
        pass
    return ok({"id": str(a.id), "version": a.version})


@router.get("/projects/{pid}/artifacts")
async def lst(
    pid: str,
    type: str | None = None,
    stage: str | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    q = select(Artifact).where(Artifact.project_id == pid, Artifact.archived_at.is_(None))
    if type:
        q = q.where(Artifact.type == type)
    if stage:
        q = q.where(Artifact.stage == stage)
    q = q.order_by(Artifact.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return paged([await _dto(db, a) for a in rows])


@router.get("/artifacts/{aid}")
async def get_one(aid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    a = await db.get(Artifact, aid)
    if not a:
        raise AppError(404, "artifact not found")
    return ok(await _dto(db, a))


@router.put("/artifacts/{aid}")
async def update(
    aid: str,
    body: dict,
    im: int | None = Depends(if_match),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    a = await db.get(Artifact, aid)
    if not a:
        raise AppError(404, "artifact not found")
    check_version(a.version, im)
    nv = a.current_version + 1
    db.add(
        ArtifactVersion(
            artifact_id=a.id,
            version=nv,
            content=body["content"],
            author=body.get("author", "user:single"),
            note=body.get("note"),
        )
    )
    a.current_version, a.version = nv, a.version + 1
    await db.commit()
    try:
        await publish(str(a.project_id), "artifact.created", {"artifact_url": str(a.id), "kind": a.type})
    except Exception:
        pass
    return ok({"id": str(a.id), "version": a.version, "currentVersion": nv})


@router.get("/artifacts/{aid}/versions")
async def versions(aid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    q = (
        select(ArtifactVersion)
        .where(ArtifactVersion.artifact_id == aid)
        .order_by(ArtifactVersion.version)
    )
    rows = (await db.execute(q)).scalars().all()
    return paged(
        [
            {"version": v.version, "author": v.author, "note": v.note,
             "createdAt": v.created_at.isoformat() if v.created_at else None}
            for v in rows
        ]
    )


@router.get("/artifacts/{aid}/versions/{v}")
async def get_version(aid: str, v: int, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    q = select(ArtifactVersion).where(
        ArtifactVersion.artifact_id == aid, ArtifactVersion.version == v
    )
    av = (await db.execute(q)).scalars().first()
    if not av:
        raise AppError(404, "version not found")
    return ok({"version": av.version, "content": av.content})


@router.get("/artifacts/{aid}/diff")
async def diff(
    aid: str,
    from_: int = Query(0, alias="from"),
    to: int = Query(0),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    return await _diff_impl(db, aid, from_, to)


async def _diff_impl(db, aid, v1, v2):
    a_text = await _version_content(db, aid, v1)
    b_text = await _version_content(db, aid, v2)
    lines = list(difflib.unified_diff(a_text.splitlines(), b_text.splitlines(), lineterm=""))
    return ok({"from": v1, "to": v2, "format": "unified", "lines": lines})


@router.post("/projects/{pid}/artifacts/{aid}/references")
async def set_references(
    pid: str,
    aid: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    """保存 CRD/PRD 关联的参考资料 ID 列表（写入 artifact.extra.references）。"""
    a = await db.get(Artifact, aid)
    if not a or a.project_id != pid:
        raise AppError(404, "artifact not found")
    extra = dict(a.extra or {})
    extra["references"] = body.get("materialIds", [])
    a.extra = extra
    await db.commit()
    return ok({"id": aid, "references": extra["references"]})


@router.post("/projects/{pid}/artifacts/{aid}/submit-version")
async def submit_version(
    pid: str,
    aid: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    """版本提交：将草稿 content 写入新 ArtifactVersion，与对话修改分离。"""
    a = await db.get(Artifact, aid)
    if not a or a.project_id != pid:
        raise AppError(404, "artifact not found")
    nv = a.current_version + 1
    db.add(
        ArtifactVersion(
            artifact_id=a.id,
            version=nv,
            content=body.get("content", ""),
            author="user:single",
            note=body.get("note", "版本提交"),
        )
    )
    a.current_version, a.version = nv, a.version + 1
    await db.commit()
    try:
        await publish(str(pid), "artifact.created", {"artifact_url": str(a.id), "kind": a.type})
    except Exception:
        pass
    return ok({"id": aid, "version": nv})


@router.post("/artifacts/{aid}/rollback")
async def rollback(aid: str, body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    target = body["toVersion"]
    content = await _version_content(db, aid, target)
    q = select(ArtifactVersion).where(
        ArtifactVersion.artifact_id == aid, ArtifactVersion.version == target
    )
    if not (await db.execute(q)).scalars().first():
        raise AppError(404, "version not found")
    a = await db.get(Artifact, aid)
    nv = a.current_version + 1
    db.add(
        ArtifactVersion(
            artifact_id=a.id, version=nv, content=content, author="user:single",
            note=f"rollback to v{target}",
        )
    )
    a.current_version, a.version = nv, a.version + 1
    await db.commit()
    return ok({"rolledBackTo": target, "newVersion": nv})

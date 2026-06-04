"""工件读取辅助：取某类型最新工件及其最新版本内容。"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.entities import Artifact, ArtifactVersion


async def latest_artifact(db: AsyncSession, pid: str, doc_type: str) -> Artifact | None:
    q = (
        select(Artifact)
        .where(
            Artifact.project_id == pid,
            Artifact.type == doc_type,
            Artifact.archived_at.is_(None),
        )
        .order_by(Artifact.created_at.desc())
        .limit(1)
    )
    return (await db.execute(q)).scalars().first()


async def latest_version(db: AsyncSession, aid: str) -> ArtifactVersion | None:
    q = (
        select(ArtifactVersion)
        .where(ArtifactVersion.artifact_id == aid)
        .order_by(ArtifactVersion.version.desc())
        .limit(1)
    )
    return (await db.execute(q)).scalars().first()


async def latest_content(db: AsyncSession, pid: str, doc_type: str) -> str:
    art = await latest_artifact(db, pid, doc_type)
    if not art:
        return ""
    v = await latest_version(db, art.id)
    return (v.content if v else "") or ""

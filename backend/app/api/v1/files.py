"""文件上传临时存储 API（T-BE-01）。

POST   /projects/{pid}/files/upload  multipart，存 BLOB_DIR/tmp/{pid}/
GET    /projects/{pid}/files         列出该项目的上传文件
DELETE /projects/{pid}/files/{fid}  删除文件记录与实体
"""
import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...config import settings
from ...deps import require_auth
from ...db import get_db
from ...models.entities import UploadedFile
from ._common import ok, paged

log = logging.getLogger(__name__)
router = APIRouter(tags=["files"])


def _tmp_dir(pid: str) -> Path:
    p = Path(settings.blob_dir) / "tmp" / pid
    p.mkdir(parents=True, exist_ok=True)
    return p


def _file_dto(f: UploadedFile) -> dict:
    return {
        "id": str(f.id),
        "name": f.name,
        "size": f.size,
        "mimeType": f.mime_type,
        "status": f.status,
        "parsedArtifactId": f.parsed_artifact_id,
        "createdAt": f.created_at.isoformat() if f.created_at else None,
    }


@router.post("/projects/{pid}/files/upload")
async def upload_file(
    pid: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    content = await file.read()
    fid = str(uuid.uuid4())
    suffix = Path(file.filename or "file").suffix
    safe_name = f"{fid}{suffix}"
    dest = _tmp_dir(pid) / safe_name
    dest.write_bytes(content)

    rec = UploadedFile(
        id=fid,
        project_id=pid,
        name=file.filename or safe_name,
        path=str(dest),
        size=len(content),
        mime_type=file.content_type or "application/octet-stream",
        status="uploaded",
    )
    db.add(rec)
    await db.commit()
    log.info("uploaded file %s (%d bytes) for project %s", file.filename, len(content), pid)
    return ok(_file_dto(rec))


@router.get("/projects/{pid}/files")
async def list_files(
    pid: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    rows = (
        await db.execute(
            select(UploadedFile)
            .where(UploadedFile.project_id == pid)
            .order_by(UploadedFile.created_at.desc())
        )
    ).scalars().all()
    return paged([_file_dto(r) for r in rows])


@router.delete("/projects/{pid}/files/{fid}")
async def delete_file(
    pid: str,
    fid: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    rec = await db.get(UploadedFile, fid)
    if not rec or rec.project_id != pid:
        raise HTTPException(404, "file not found")
    # 删实体文件（容忍不存在）
    try:
        Path(rec.path).unlink(missing_ok=True)
    except Exception:
        pass
    await db.delete(rec)
    await db.commit()
    return ok({"deleted": True})


# ---------------------------------------------------------------------------
# 启动时注册：每小时清理 7 天前的临时文件
# ---------------------------------------------------------------------------
async def _cleanup_loop() -> None:
    while True:
        await asyncio.sleep(3600)
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(days=7)
            from ...db import SessionLocal
            async with SessionLocal() as db:
                old = (
                    await db.execute(
                        select(UploadedFile).where(UploadedFile.created_at < cutoff)
                    )
                ).scalars().all()
                for rec in old:
                    try:
                        Path(rec.path).unlink(missing_ok=True)
                    except Exception:
                        pass
                    await db.delete(rec)
                await db.commit()
                if old:
                    log.info("cleanup: removed %d stale uploaded files", len(old))
        except Exception as exc:
            log.warning("cleanup error: %s", exc)


def start_cleanup_task() -> None:
    """在 FastAPI lifespan 中调用，注册后台清理协程。"""
    asyncio.ensure_future(_cleanup_loop())

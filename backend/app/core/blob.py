"""本地工件 blob 存储（T-INFRA-04）。

内容寻址（sha256），同 hash 不重复存。无需 aiofiles，用线程池避免阻塞事件循环。
"""
import hashlib
import asyncio
from pathlib import Path

from ..config import settings

ROOT = Path(settings.blob_dir)
ROOT.mkdir(parents=True, exist_ok=True)


def _put_sync(content: bytes) -> str:
    digest = hashlib.sha256(content).hexdigest()
    p = ROOT / digest[:2] / digest
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_bytes(content)
    return f"blob://{digest}"


def _get_sync(ref: str) -> bytes:
    digest = ref.removeprefix("blob://")
    return (ROOT / digest[:2] / digest).read_bytes()


async def put(content: bytes) -> str:
    return await asyncio.to_thread(_put_sync, content)


async def get(ref: str) -> bytes:
    return await asyncio.to_thread(_get_sync, ref)

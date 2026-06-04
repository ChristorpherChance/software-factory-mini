"""设置导入导出（T-SET-06 · YAML，密钥遮蔽不导出）。"""
import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.entities import Setting, Endpoint


async def export_yaml(db: AsyncSession, pid: str) -> str:
    rows = (
        await db.execute(select(Setting).where(Setting.project_id == pid))
    ).scalars().all()
    eps = (
        await db.execute(select(Endpoint).where(Endpoint.project_id == pid))
    ).scalars().all()
    doc = {
        "settings": [
            {"category": s.category, "key": s.key, "value": ("***" if s.is_secret else s.value)}
            for s in rows
        ],
        "endpoints": [
            {
                "kind": e.kind,
                "name": e.name,
                "baseUrl": e.base_url,
                "model": e.model,
                "hasKey": bool(e.api_key_cipher),
            }
            for e in eps
        ],
    }
    return yaml.safe_dump(doc, allow_unicode=True, sort_keys=False)


async def import_yaml(db: AsyncSession, pid: str, text: str, actor: str) -> dict:
    doc = yaml.safe_load(text) or {}
    for s in doc.get("settings", []):
        if s.get("value") == "***":  # 跳过被遮蔽的密文占位
            continue
        db.add(
            Setting(
                scope="project",
                project_id=pid,
                category=s["category"],
                key=s["key"],
                value=s["value"],
            )
        )
    for e in doc.get("endpoints", []):
        db.add(
            Endpoint(
                project_id=pid,
                kind=e["kind"],
                name=e["name"],
                base_url=e.get("baseUrl"),
                model=e.get("model"),
            )
        )
    await db.commit()
    return {
        "imported": True,
        "settings": len(doc.get("settings", [])),
        "endpoints": len(doc.get("endpoints", [])),
    }

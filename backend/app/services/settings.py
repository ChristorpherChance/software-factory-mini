"""设置服务（T-SET-02 · 加载/合并/解析 + 会话覆盖）。

优先级：default < global < project < session_override。
密钥（is_secret）只回 masked 提示，明文不出后端。
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.entities import Setting, Endpoint, SessionSettingOverride, SettingAudit
from ..core.crypto import decrypt, mask

DEFAULTS = {
    "model": {"provider": "pi", "name": "claude-3-5-sonnet", "temperature": 0.0},
    "hitl": {"mode": "Semi"},
    "kb": {"enabled": False, "top_k": 5},
    "sandbox": {"network": False, "timeout_s": 120},
    "general": {"locale": "zh-CN", "timezone": "Asia/Shanghai"},
}


async def resolve(db: AsyncSession, pid: str, session_id: str | None = None) -> dict:
    merged = {c: dict(v) for c, v in DEFAULTS.items()}
    rows = (
        await db.execute(
            select(Setting).where((Setting.scope == "global") | (Setting.project_id == pid))
        )
    ).scalars().all()
    # 先 global 后 project（project 覆盖 global）
    for s in sorted(rows, key=lambda r: 0 if r.scope == "global" else 1):
        merged.setdefault(s.category, {})[s.key] = mask(s.value) if s.is_secret else s.value
    if session_id:
        ovs = (
            await db.execute(
                select(SessionSettingOverride).where(
                    SessionSettingOverride.session_id == session_id
                )
            )
        ).scalars().all()
        for o in ovs:
            merged.setdefault(o.category, {})[o.key] = o.value
    return merged


async def set_override(
    db: AsyncSession, session_id: str, category: str, key: str, value, actor: str
) -> dict:
    ov = (
        await db.execute(
            select(SessionSettingOverride).where(
                SessionSettingOverride.session_id == session_id,
                SessionSettingOverride.category == category,
                SessionSettingOverride.key == key,
            )
        )
    ).scalars().first()
    old = ov.value if ov else None
    if ov:
        ov.value = value
    else:
        ov = SessionSettingOverride(session_id=session_id, category=category, key=key, value=value)
        db.add(ov)
    db.add(
        SettingAudit(
            session_id=session_id,
            category=category,
            key=key,
            old_value=old,
            new_value=value,
            actor=actor,
        )
    )
    await db.commit()
    return {"category": category, "key": key, "value": value}


async def resolve_llm_endpoint(db: AsyncSession, pid: str, name: str | None = None) -> dict:
    """解密 LLM 端点供后端调用（不返回前端）。"""
    q = select(Endpoint).where(
        Endpoint.project_id == pid, Endpoint.kind == "llm", Endpoint.enabled == True  # noqa: E712
    )
    if name:
        q = q.where(Endpoint.name == name)
    ep = (await db.execute(q)).scalars().first()
    if not ep:
        return DEFAULTS["model"]
    return {
        "provider": ep.extra.get("provider", "pi"),
        "base_url": ep.base_url,
        "model": ep.model,
        "api_key": decrypt(ep.api_key_cipher) if ep.api_key_cipher else None,
    }

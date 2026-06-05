"""设置服务（T-SET-02 · 加载/合并/解析 + 会话覆盖）。

优先级：default < global < project < session_override。
密钥（is_secret）只回 masked 提示，明文不出后端。
"""
from sqlalchemy import select, or_, func
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


async def resolve_llm_endpoint(db: AsyncSession, pid: str, ident: str | None = None) -> dict:
    """解密 LLM 端点供后端调用（不返回前端）。

    ident：会话级 model.name 覆盖值。ModelPicker 现在存端点 **id**；同时兼容历史覆盖值
    （旧版可能存的是 name 或 model 串），按 id / name / model 任一匹配，避免静默回退默认。
    """
    q = select(Endpoint).where(
        Endpoint.project_id == pid, Endpoint.kind == "llm", Endpoint.enabled == True  # noqa: E712
    )
    if ident:
        q = q.where(
            or_(Endpoint.id == ident, Endpoint.name == ident, Endpoint.model == ident)
        )
    ep = (await db.execute(q)).scalars().first()
    if not ep:
        return DEFAULTS["model"]
    return {
        "provider": ep.extra.get("provider", "pi"),
        "base_url": ep.base_url,
        "model": ep.model,
        "api_key": decrypt(ep.api_key_cipher) if ep.api_key_cipher else None,
    }


# 开箱即用：本地 Ollama 两个常用模型。仅在项目「尚无任何 LLM 端点」时播种，
# 故不会复活用户手动删掉的端点；连不通也无妨（ModelPicker 会标 ❌ 并禁用）。
# 模型 tag 用户可在设置页改成实际拉取的（如 qwen3:30b）。
_DEFAULT_LLM_ENDPOINTS = [
    {"name": "Ollama Qwen3", "provider": "ollama",
     "base_url": "http://localhost:11434/v1", "model": "qwen3.6:27b"},
    {"name": "Ollama DeepSeek-R1", "provider": "ollama",
     "base_url": "http://localhost:11434/v1", "model": "deepseek-r1:14b"},
]


async def seed_default_endpoints(db: AsyncSession, pid: str) -> int:
    """项目无任何 LLM 端点时，幂等播种本地 Ollama 默认端点。返回新建数量。"""
    n = (
        await db.execute(
            select(func.count()).select_from(Endpoint).where(
                Endpoint.project_id == pid, Endpoint.kind == "llm"
            )
        )
    ).scalar() or 0
    if n:
        return 0
    for d in _DEFAULT_LLM_ENDPOINTS:
        db.add(
            Endpoint(
                project_id=pid,
                kind="llm",
                name=d["name"],
                base_url=d["base_url"],
                model=d["model"],
                extra={"provider": d["provider"]},
                enabled=True,
            )
        )
    await db.commit()
    return len(_DEFAULT_LLM_ENDPOINTS)


async def seed_endpoints_for_existing_projects(db: AsyncSession) -> int:
    """启动 backfill：为现有「真实」项目（非归档、非 __ 内部容器）播种默认端点。"""
    from ..models.entities import Project

    pids = (
        await db.execute(
            select(Project.id).where(
                Project.archived_at.is_(None),
                Project.name.notlike("\\_\\_%", escape="\\"),
            )
        )
    ).scalars().all()
    total = 0
    for pid in pids:
        total += await seed_default_endpoints(db, str(pid))
    return total

"""把各 slot 的「当前绑定版本」内容解析成 {slot: content}，供编排注入 contextvar。"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.entities import ArtifactVersion, AgentPromptBinding
from .prompt_seed import container_pid, SLOT_KEYS


async def load_active_prompts(db: AsyncSession) -> dict[str, str]:
    """返回 {slot: 当前版本内容}（全局容器；缺内容的槽位略过，由调用方回落默认）。"""
    pid = await container_pid(db)
    bindings = (
        await db.execute(
            select(AgentPromptBinding).where(AgentPromptBinding.project_id == pid)
        )
    ).scalars().all()
    out: dict[str, str] = {}
    for b in bindings:
        if b.agent_slot not in SLOT_KEYS:
            continue
        v = (
            await db.execute(
                select(ArtifactVersion).where(
                    ArtifactVersion.artifact_id == b.artifact_id,
                    ArtifactVersion.version == b.current_version,
                )
            )
        ).scalars().first()
        if v and v.content:
            out[b.agent_slot] = v.content
    return out

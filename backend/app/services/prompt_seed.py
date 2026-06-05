"""各阶段 Agent Prompt 的系统默认种子（只读）+ 全局容器项目。

复用 Artifact(type="agent_prompt") + ArtifactVersion 存多版本；
version=1 / author="system" 为系统默认，受 readonly 守卫保护，永不被改。
版本名/只读标记存 ArtifactVersion.note（JSON），零新列、零迁移。
"""
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.entities import Project, Artifact, ArtifactVersion, AgentPromptBinding
from ..core.llm import MATERIAL_SYSTEM, _REQ_PROMPT

CONTAINER_NAME = "__agent_prompts__"

# 5 个子 Agent 槽位（资料：文件解析/内容解析；需求：CRD/PRD/RTM）
SLOTS: list[tuple[str, str]] = [
    ("material.file_parse", "资料阶段 · 文件解析"),
    ("material.content_parse", "资料阶段 · 内容解析"),
    ("requirement.crd", "需求阶段 · 客户需求 CRD"),
    ("requirement.prd", "需求阶段 · 产品需求 PRD"),
    ("requirement.rtm", "需求阶段 · 需求矩阵 RTM"),
]
SLOT_KEYS = {s for s, _ in SLOTS}

_RTM_DEFAULT = (
    "（占位）RTM 需求矩阵当前由系统按需求文档中的编号与「上溯：」行规则抽取生成，"
    "暂不经 LLM Prompt。此处保存内容暂不影响生成，作为前瞻配置保留。"
)

SYSTEM_DEFAULTS: dict[str, str] = {
    "material.file_parse": MATERIAL_SYSTEM,
    "material.content_parse": MATERIAL_SYSTEM,
    "requirement.crd": _REQ_PROMPT["crd"],
    "requirement.prd": _REQ_PROMPT["prd"],
    "requirement.rtm": _RTM_DEFAULT,
}


def make_note(name: str, readonly: bool = False) -> str:
    return json.dumps({"name": name, "readonly": readonly}, ensure_ascii=False)


def parse_note(note: str | None) -> dict:
    if not note:
        return {}
    try:
        d = json.loads(note)
        return d if isinstance(d, dict) else {"name": str(note)}
    except Exception:
        return {"name": note}


async def container_pid(db: AsyncSession) -> str:
    """全局容器项目 id（缺则建）；Agent Prompt 工件均挂其下，跨项目共享。"""
    proj = (
        await db.execute(select(Project).where(Project.name == CONTAINER_NAME))
    ).scalars().first()
    if proj:
        return proj.id
    proj = Project(name=CONTAINER_NAME, description="Agent Prompt 配置容器（自动创建）")
    db.add(proj)
    await db.flush()
    return proj.id


async def seed_prompts(db: AsyncSession) -> None:
    """幂等种子：每个 slot 缺绑定则建 Artifact + v1(系统默认/只读) + 绑定。"""
    pid = await container_pid(db)
    changed = False
    for slot, title in SLOTS:
        exists = (
            await db.execute(
                select(AgentPromptBinding).where(
                    AgentPromptBinding.project_id == pid,
                    AgentPromptBinding.agent_slot == slot,
                )
            )
        ).scalars().first()
        if exists:
            continue
        art = Artifact(
            project_id=pid, type="agent_prompt", title=title, stage="agent_config"
        )
        db.add(art)
        await db.flush()
        db.add(
            ArtifactVersion(
                artifact_id=art.id,
                version=1,
                content=SYSTEM_DEFAULTS.get(slot, ""),
                author="system",
                note=make_note("系统默认", readonly=True),
            )
        )
        db.add(
            AgentPromptBinding(
                project_id=pid,
                agent_slot=slot,
                artifact_id=art.id,
                current_version=1,
            )
        )
        changed = True
    if changed:
        await db.commit()

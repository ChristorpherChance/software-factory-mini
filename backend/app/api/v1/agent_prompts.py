"""各阶段 Agent Prompt 多版本配置 API。

挂 /api/v1/projects/{pid}/agent-prompts/*（pid 仅为前端路由便利；存储为全局容器，跨项目共享）。
复用 Artifact(type=agent_prompt)+ArtifactVersion 存多版本 + AgentPromptBinding 指针，零新表。
不走能力库 0.85 评测门禁、不 publish（避免污染需求工件查询）。系统默认（v1/author=system）只读。
"""
from fastapi import APIRouter, Depends, Body
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db
from ...core.errors import AppError
from ...models.entities import Artifact, ArtifactVersion, AgentPromptBinding
from ...services.prompt_seed import (
    SLOTS,
    SLOT_KEYS,
    container_pid,
    seed_prompts,
    make_note,
    parse_note,
)
from ._common import ok, paged

router = APIRouter(tags=["agent-prompts"])

_SLOT_TITLE = dict(SLOTS)


def _is_readonly(v: ArtifactVersion) -> bool:
    return v.author == "system" or v.version == 1 or bool(parse_note(v.note).get("readonly"))


def _guard_readonly(v: ArtifactVersion) -> None:
    if _is_readonly(v):
        raise AppError(403, "系统默认 Prompt 只读，不可修改/改名/删除", "FORBIDDEN")


async def _binding(db: AsyncSession, slot: str) -> AgentPromptBinding:
    if slot not in SLOT_KEYS:
        raise AppError(404, f"unknown agent slot: {slot}")
    pid = await container_pid(db)
    b = (
        await db.execute(
            select(AgentPromptBinding).where(
                AgentPromptBinding.project_id == pid,
                AgentPromptBinding.agent_slot == slot,
            )
        )
    ).scalars().first()
    if not b:
        await seed_prompts(db)
        b = (
            await db.execute(
                select(AgentPromptBinding).where(
                    AgentPromptBinding.project_id == pid,
                    AgentPromptBinding.agent_slot == slot,
                )
            )
        ).scalars().first()
    if not b:
        raise AppError(404, "slot not initialized")
    return b


async def _get_version(db: AsyncSession, aid: str, v: int) -> ArtifactVersion:
    ver = (
        await db.execute(
            select(ArtifactVersion).where(
                ArtifactVersion.artifact_id == aid, ArtifactVersion.version == v
            )
        )
    ).scalars().first()
    if not ver:
        raise AppError(404, f"version {v} not found")
    return ver


@router.get("/projects/{pid}/agent-prompts")
async def list_prompts(pid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """列出 5 个 slot 及各自版本概览 + 当前指针 + 系统默认内容。"""
    await seed_prompts(db)  # 幂等确保槽位齐全
    cpid = await container_pid(db)
    out = []
    for slot, title in SLOTS:
        b = (
            await db.execute(
                select(AgentPromptBinding).where(
                    AgentPromptBinding.project_id == cpid,
                    AgentPromptBinding.agent_slot == slot,
                )
            )
        ).scalars().first()
        if not b:
            continue
        vers = (
            await db.execute(
                select(ArtifactVersion)
                .where(ArtifactVersion.artifact_id == b.artifact_id)
                .order_by(ArtifactVersion.version)
            )
        ).scalars().all()
        default = next((v for v in vers if v.version == 1), None)
        out.append(
            {
                "slot": slot,
                "title": title,
                "artifactId": str(b.artifact_id),
                "currentVersion": b.current_version,
                "defaultContent": (default.content if default else "") or "",
                "versions": [
                    {
                        "version": v.version,
                        "name": parse_note(v.note).get("name", f"版本 {v.version}"),
                        "author": v.author,
                        "readonly": _is_readonly(v),
                        "createdAt": v.created_at.isoformat() if v.created_at else None,
                    }
                    for v in vers
                ],
            }
        )
    return paged(out)


@router.get("/projects/{pid}/agent-prompts/{slot}/versions/{v}")
async def get_version(
    pid: str, slot: str, v: int, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    b = await _binding(db, slot)
    ver = await _get_version(db, b.artifact_id, v)
    note = parse_note(ver.note)
    return ok(
        {
            "version": ver.version,
            "name": note.get("name", f"版本 {ver.version}"),
            "content": ver.content or "",
            "readonly": _is_readonly(ver),
        }
    )


@router.post("/projects/{pid}/agent-prompts/{slot}/versions")
async def create_version(
    pid: str,
    slot: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    """新建版本（通常由「勾选默认→修改」而来）。version = 最高版+1，可改名。"""
    b = await _binding(db, slot)
    art = await db.get(Artifact, b.artifact_id)
    content = body.get("content", "")
    nv = art.current_version + 1
    name = body.get("name") or f"版本 {nv}"
    art.current_version, art.version = nv, art.version + 1
    db.add(
        ArtifactVersion(
            artifact_id=art.id,
            version=nv,
            content=content,
            author="user:single",
            note=make_note(name, readonly=False),
        )
    )
    await db.commit()
    return ok({"version": nv, "name": name})


@router.patch("/projects/{pid}/agent-prompts/{slot}/versions/{v}")
async def rename_version(
    pid: str,
    slot: str,
    v: int,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    b = await _binding(db, slot)
    ver = await _get_version(db, b.artifact_id, v)
    _guard_readonly(ver)
    name = body.get("name", "")
    ver.note = make_note(name, readonly=False)
    await db.commit()
    return ok({"version": v, "name": name})


@router.post("/projects/{pid}/agent-prompts/{slot}/beautify")
async def beautify(
    pid: str,
    slot: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    """美化（问题1）：把用户粘贴的草稿整理为规范提示词。pi 调 agent-service，其它回落 stub 模板。"""
    await _binding(db, slot)  # 校验 slot 合法
    from ...core.llm import beautify_prompt

    content = await beautify_prompt(body.get("content", ""))
    return ok({"content": content})


@router.put("/projects/{pid}/agent-prompts/{slot}/current")
async def set_current(
    pid: str,
    slot: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    b = await _binding(db, slot)
    version = int(body["version"])
    await _get_version(db, b.artifact_id, version)  # 校验存在
    b.current_version = version
    await db.commit()
    return ok({"slot": slot, "currentVersion": version})


@router.delete("/projects/{pid}/agent-prompts/{slot}/versions/{v}")
async def delete_version(
    pid: str, slot: str, v: int, db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    b = await _binding(db, slot)
    ver = await _get_version(db, b.artifact_id, v)
    _guard_readonly(ver)
    await db.delete(ver)
    if b.current_version == v:
        b.current_version = 1  # 删的是当前版本 → 回退系统默认
    await db.commit()
    return ok({"deleted": True, "currentVersion": b.current_version})

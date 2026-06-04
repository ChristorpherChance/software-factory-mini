"""能力进化双环（Phase 3.5）：Skill/Prompt/AGENTS.md 提案 → 审批 → 应用 → 回滚。

挂 /api/v1/internal/capability/*。复用 Artifact(type=skill|prompt|agent_md) + ArtifactVersion
+ PendingChange(target_type=skill_change) + 现有 hitl/diff_blocks，零新表。

- propose：落 Artifact + Version(author=agent) + PendingChange，不写盘
- list：列出能力库（按 type）
- approve：审批 PendingChange（复用 pending 决策）
- apply：校验已审批 + 回归评测≥0.85，返回内容（实际写盘由 agent-service skill_apply 做）
- rollback：返回上一版本内容
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db
from ...models.entities import Artifact, ArtifactVersion, PendingChange, Project, HitlDecision
from ...core.events import publish
from ._common import ok, paged

router = APIRouter(tags=["capability"])

CAP_TYPES = {"skill", "prompt", "agent_md"}


async def _default_pid(db: AsyncSession, pid: str | None) -> str:
    """capability 落库需 project_id：用传入 pid，否则取/建一个 capability 容器项目。"""
    if pid:
        return pid
    cap = (
        await db.execute(select(Project).where(Project.name == "__capabilities__"))
    ).scalars().first()
    if cap:
        return cap.id
    cap = Project(name="__capabilities__", description="能力库容器（自动创建）")
    db.add(cap)
    await db.flush()
    return cap.id


def _to_diff_blocks(content: str) -> list[dict]:
    """能力草案切块（全 add，复用前端 DiffBlock 渲染）。"""
    lines = content.splitlines() or [""]
    return [{"id": "b1", "kind": "add", "tag": "＋ 新增", "lines": lines, "state": "pending"}]


@router.post("/internal/capability/propose")
async def propose(body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """提案：落 Artifact + Version + PendingChange（不写盘）。

    body: { name, kind(skill|prompt|agent_md), draft, rationale, eval_cases?, project_id? }
    """
    kind = body.get("kind")
    if kind not in CAP_TYPES:
        raise HTTPException(400, f"invalid kind: {kind}")
    pid = await _default_pid(db, body.get("project_id"))
    name = body["name"]
    draft = body.get("draft", "")

    # 同名能力则升版本，否则新建
    art = (
        await db.execute(
            select(Artifact).where(
                Artifact.project_id == pid, Artifact.type == kind, Artifact.title == name,
                Artifact.archived_at.is_(None),
            )
        )
    ).scalars().first()
    if art:
        nv = art.current_version + 1
        art.current_version, art.version = nv, art.version + 1
    else:
        art = Artifact(project_id=pid, type=kind, title=name, stage="capability")
        db.add(art)
        await db.flush()
        nv = 1
    ver = ArtifactVersion(
        artifact_id=art.id, version=nv, content=draft, author="agent",
        note=body.get("rationale", ""),
    )
    db.add(ver)
    await db.flush()

    pc = PendingChange(
        project_id=pid, target_type="skill_change", target_id=str(art.id), op="capability",
        diff={"kind": kind, "name": name, "version_id": str(ver.id),
              "rationale": body.get("rationale", ""), "eval_cases": body.get("eval_cases", [])},
        diff_blocks=_to_diff_blocks(draft),
        source_actor="agent:skill_propose", hitl_mode="Semi",
    )
    db.add(pc)
    await db.commit()
    await publish(
        str(art.id), "hitl.request",
        {"pending_change_id": str(pc.id), "kind": "skill_change", "name": name},
    )
    return ok({"version_id": str(ver.id), "pending_change_id": str(pc.id),
               "artifact_id": str(art.id), "version": nv})


@router.get("/internal/capability/list")
async def list_caps(db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    arts = (
        await db.execute(
            select(Artifact).where(Artifact.type.in_(CAP_TYPES), Artifact.archived_at.is_(None))
            .order_by(Artifact.created_at.desc())
        )
    ).scalars().all()
    out = []
    for a in arts:
        latest = (
            await db.execute(
                select(ArtifactVersion).where(ArtifactVersion.artifact_id == a.id)
                .order_by(ArtifactVersion.version.desc()).limit(1)
            )
        ).scalars().first()
        out.append({
            "id": str(a.id), "kind": a.type, "name": a.title,
            "currentVersion": a.current_version,
            "latestVersionId": str(latest.id) if latest else None,
            "content": (latest.content if latest else "") or "",
            "status": a.status,
        })
    return paged(out)


@router.get("/internal/capability/{aid}/versions")
async def versions(aid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    rows = (
        await db.execute(
            select(ArtifactVersion).where(ArtifactVersion.artifact_id == aid)
            .order_by(ArtifactVersion.version)
        )
    ).scalars().all()
    return paged([{"versionId": str(v.id), "version": v.version, "author": v.author,
                   "note": v.note, "content": v.content or ""} for v in rows])


@router.post("/internal/capability/approve")
async def approve(body: dict, db: AsyncSession = Depends(get_db), actor=Depends(require_auth)):
    cid = body["pending_change_id"]
    pc = await db.get(PendingChange, cid)
    if not pc:
        raise HTTPException(404, "pending change not found")
    pc.status = "approved"
    db.add(HitlDecision(pending_change_id=pc.id, decision="approve",
                        decided_by=actor.get("id", "user"), reason=body.get("reason")))
    await db.commit()
    return ok({"approved": True})


async def _version_by_id(db: AsyncSession, version_id: str) -> ArtifactVersion:
    v = await db.get(ArtifactVersion, version_id)
    if not v:
        raise HTTPException(404, "version not found")
    return v


@router.post("/internal/capability/apply")
async def apply(body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """校验已审批 + 回归评测≥0.85，返回 {kind,name,content} 供 agent-service 写盘。"""
    from ...services import capability_eval

    version_id = body["version_id"]
    ver = await _version_by_id(db, version_id)
    art = await db.get(Artifact, ver.artifact_id)

    # 校验：该工件存在已审批的 PendingChange
    approved = (
        await db.execute(
            select(PendingChange).where(
                PendingChange.target_id == str(art.id),
                PendingChange.target_type == "skill_change",
                PendingChange.status == "approved",
            )
        )
    ).scalars().first()
    if not approved:
        raise HTTPException(409, "version not approved")

    # 回归评测门限 0.85
    score = await capability_eval.run(db, ver)
    if score < 0.85:
        raise HTTPException(422, f"regression eval {score:.2f} < 0.85")

    art.status = "finalized"
    await db.commit()
    return ok({"kind": art.type, "name": art.title, "content": ver.content or "",
               "version_id": version_id, "score": score})


@router.post("/internal/capability/rollback")
async def rollback(body: dict, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    """返回上一版本内容（供 agent-service 写回 .pi/）。"""
    version_id = body["version_id"]
    ver = await _version_by_id(db, version_id)
    prev = (
        await db.execute(
            select(ArtifactVersion).where(
                ArtifactVersion.artifact_id == ver.artifact_id,
                ArtifactVersion.version < ver.version,
            ).order_by(ArtifactVersion.version.desc()).limit(1)
        )
    ).scalars().first()
    if not prev:
        raise HTTPException(404, "no previous version")
    art = await db.get(Artifact, ver.artifact_id)
    return ok({"kind": art.type, "name": art.title, "content": prev.content or "",
               "version_id": str(prev.id), "version": prev.version})

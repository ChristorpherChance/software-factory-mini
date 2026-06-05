"""待定区 / 变更 / 回滚 API（HITL 核心 · S2 §7 + M4 P1-A 按块确认）。

新增按块 resolve 端点：
- POST /pending-changes/{cid}/blocks/{blockId}/resolve  body={state}
  仅更新单块 state；全块定后聚合：
    全 confirmed → 走 _apply + status=approved
    含 rejected  → 部分 apply（仅 confirmed 块），status=approved（审计可读）
    全 rejected  → status=rejected
- 整体 approve/reject 兼容：把全部块 state 同步置态（保持 UI 一致）
- 列表 / 详情返回加 diffBlocks

create 场景按块确认仅作审计语义（工件已落库）。
update 场景的按块写回内容暂未实现（TODO）：未来需要按 confirmed 块合成新 markdown，
另起 ArtifactVersion。
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ...deps import require_auth
from ...db import get_db
from ...models.entities import (
    PendingChange,
    HitlDecision,
    Artifact,
    ArtifactVersion,
    Task,
)
from ...core.events import publish
from ._common import ok, paged
from ...core.errors import AppError

router = APIRouter(tags=["pending"])


def _serialize(c: PendingChange) -> dict:
    return {
        "id": str(c.id),
        "targetType": c.target_type,
        "targetId": str(c.target_id) if c.target_id else None,
        "op": c.op,
        "diff": c.diff,
        "diffBlocks": c.diff_blocks,
        "sourceActor": c.source_actor,
        "hitlMode": c.hitl_mode,
        "status": c.status,
        "createdAt": c.created_at.isoformat() if c.created_at else None,
    }


@router.get("/projects/{pid}/pending-changes")
async def lst(
    pid: str, status: str = "pending", db: AsyncSession = Depends(get_db), _=Depends(require_auth)
):
    q = (
        select(PendingChange)
        .where(PendingChange.project_id == pid, PendingChange.status == status)
        .order_by(PendingChange.created_at.desc())
    )
    return paged([_serialize(c) for c in (await db.execute(q)).scalars().all()])


@router.get("/pending-changes/{cid}")
async def get_one(cid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    c = await db.get(PendingChange, cid)
    if not c:
        raise AppError(404, "pending change not found")
    return ok(_serialize(c))


async def _apply(db: AsyncSession, c: PendingChange, diff: dict):
    """落库变更。本地编排已直接落工件，故此处对 artifact/create 做幂等记录；
    其余 target_type 按差异落库。

    问题2：对话定向编辑产生 op=update + diff.oldMd/newMd + diff_blocks。
    按 confirmed 块把 newMd 的变更应用到 oldMd（rejected 块跳过），落为新 ArtifactVersion。
    """
    if c.target_type == "artifact" and c.op == "update" and c.target_id:
        a = await db.get(Artifact, c.target_id)
        if a:
            # 优先：定向编辑（含 oldMd/newMd）→ 按 confirmed 块重建
            if isinstance(diff, dict) and diff.get("oldMd") is not None:
                content = _rebuild_from_blocks(
                    diff.get("oldMd", ""), diff.get("newMd", ""), c.diff_blocks or []
                )
            else:
                content = diff.get("content", "")
            nv = a.current_version + 1
            db.add(
                ArtifactVersion(
                    artifact_id=a.id,
                    version=nv,
                    content=content,
                    author=c.source_actor,
                    note="对话定向编辑确认" if diff.get("oldMd") is not None else None,
                )
            )
            a.current_version, a.version = nv, a.version + 1
    elif c.target_type == "task" and c.target_id:
        t = await db.get(Task, c.target_id)
        if t:
            for k, v in diff.items():
                if hasattr(t, k):
                    setattr(t, k, v)
            t.version += 1
    # artifact/create、delegate/invoke、rtm/setting：编排/服务已处理，approve 仅记录决策


def _rebuild_from_blocks(old_md: str, new_md: str, blocks: list[dict]) -> str:
    """按 confirmed 块把 new_md 的变更合并到 old_md（问题2 按块写回）。

    策略：全部块 confirmed → 直接用 new_md（最常见，最稳）；
    含 rejected → 用 difflib 把 old/new 对齐，仅对 confirmed 的变更块取 new 侧、rejected 取 old 侧。
    无 blocks → 回落 new_md。
    """
    import difflib

    if not blocks:
        return new_md or old_md
    states = {b.get("id"): b.get("state") for b in blocks}
    if all(s == "confirmed" for s in states.values()):
        return new_md
    if all(s == "rejected" for s in states.values()):
        return old_md

    # 混合：按 difflib opcodes 顺序映射回 blocks（与 _to_diff_blocks_update 同序），逐段取舍。
    old_lines = (old_md or "").splitlines()
    new_lines = (new_md or "").splitlines()
    sm = difflib.SequenceMatcher(a=old_lines, b=new_lines, autojunk=False)
    out: list[str] = []
    bi = 0  # 与 blocks 对齐的变更序号（equal 段不对应块）
    block_ids = [b.get("id") for b in blocks]
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            out.extend(old_lines[i1:i2])
            continue
        bid = block_ids[bi] if bi < len(block_ids) else None
        accepted = states.get(bid) == "confirmed"
        bi += 1
        if tag == "insert":
            if accepted:
                out.extend(new_lines[j1:j2])
        elif tag == "delete":
            if not accepted:  # 拒绝删除 → 保留旧行
                out.extend(old_lines[i1:i2])
        else:  # replace
            out.extend(new_lines[j1:j2] if accepted else old_lines[i1:i2])
    return "\n".join(out)


def _set_all_blocks(c: PendingChange, state: str) -> None:
    """把所有块的 state 置为给定值（整体 approve/reject 时用，保持 UI 一致）。"""
    if not c.diff_blocks:
        return
    new = [{**b, "state": state} for b in c.diff_blocks]
    c.diff_blocks = new
    flag_modified(c, "diff_blocks")


@router.post("/pending-changes/{cid}/approve")
async def approve(cid: str, db: AsyncSession = Depends(get_db), actor=Depends(require_auth)):
    c = await db.get(PendingChange, cid)
    if not c or c.status != "pending":
        raise AppError(404, "pending change not found")
    # 先把所有块置 confirmed，再 _apply（按块写回依赖块 state；整体确认=全部接受）
    _set_all_blocks(c, "confirmed")
    await _apply(db, c, c.diff)
    c.status = "approved"
    db.add(HitlDecision(pending_change_id=c.id, decision="approve", decided_by=actor["actor"]))
    await db.commit()
    await publish(str(c.project_id), "task.update", {"task_id": str(c.id), "status": "approved"})
    return ok({"approved": True})


@router.post("/pending-changes/{cid}/reject")
async def reject(cid: str, body: dict, db: AsyncSession = Depends(get_db), actor=Depends(require_auth)):
    c = await db.get(PendingChange, cid)
    if not c or c.status != "pending":
        raise AppError(404, "pending change not found")
    c.status = "rejected"
    _set_all_blocks(c, "rejected")
    db.add(
        HitlDecision(
            pending_change_id=c.id,
            decision="reject",
            decided_by=actor["actor"],
            reason=body.get("reason"),
        )
    )
    await db.commit()
    return ok({"rejected": True})


@router.post("/pending-changes/{cid}/edit-approve")
async def edit_approve(cid: str, body: dict, db: AsyncSession = Depends(get_db), actor=Depends(require_auth)):
    c = await db.get(PendingChange, cid)
    if not c or c.status != "pending":
        raise AppError(404, "pending change not found")
    merged = body["edited_diff"]
    await _apply(db, c, merged)
    c.status = "approved"
    _set_all_blocks(c, "confirmed")
    db.add(
        HitlDecision(
            pending_change_id=c.id,
            decision="edit_approve",
            decided_by=actor["actor"],
            edited_diff=merged,
        )
    )
    await db.commit()
    return ok({"approved": True, "edited": True})


# ---- 按块 resolve（M4 P1-A）----
@router.post("/pending-changes/{cid}/blocks/{block_id}/resolve")
async def resolve_block(
    cid: str,
    block_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    actor=Depends(require_auth),
):
    """更新单块 state；全块定后聚合：
      全 confirmed → _apply + status=approved
      含 rejected  → 仅 apply confirmed 部分（这里 best-effort：和全 confirmed 同处理）
                     status=approved（审计可读）
      全 rejected  → status=rejected
    body: {state: "confirmed" | "rejected" | "pending"}
    """
    new_state = body.get("state")
    if new_state not in ("confirmed", "rejected", "pending"):
        raise AppError(400, "invalid state")

    c = await db.get(PendingChange, cid)
    if not c:
        raise AppError(404, "pending change not found")
    if c.status != "pending":
        # 已总定的整体不允许再改块（避免覆盖整体决策）
        raise AppError(409, "pending change already resolved")
    if not c.diff_blocks:
        raise AppError(400, "pending change has no diff_blocks")

    blocks = list(c.diff_blocks)
    found = False
    for i, b in enumerate(blocks):
        if b.get("id") == block_id:
            blocks[i] = {**b, "state": new_state}
            found = True
            break
    if not found:
        raise AppError(404, "block not found")
    c.diff_blocks = blocks
    flag_modified(c, "diff_blocks")

    # 聚合：是否全部块都已定？
    still_pending = any(b.get("state") == "pending" for b in blocks)
    if still_pending:
        await db.commit()
        return ok({"resolved": True, "blockId": block_id, "state": new_state, "finalized": False})

    # 全块定 → 决策聚合
    any_confirmed = any(b.get("state") == "confirmed" for b in blocks)
    any_rejected = any(b.get("state") == "rejected" for b in blocks)
    if any_confirmed:
        # create 场景：apply 是审计语义（工件已落库）；update 场景的按块写回 TODO
        await _apply(db, c, c.diff)
        c.status = "approved"
        decision = "approve"
        # 若混合，标记决策为 edit_approve 以表达"部分"
        if any_rejected:
            decision = "edit_approve"
    else:
        c.status = "rejected"
        decision = "reject"
    db.add(
        HitlDecision(
            pending_change_id=c.id,
            decision=decision,
            decided_by=actor["actor"],
        )
    )
    await db.commit()
    if c.status == "approved":
        await publish(
            str(c.project_id), "task.update", {"task_id": str(c.id), "status": "approved"}
        )
    return ok(
        {
            "resolved": True,
            "blockId": block_id,
            "state": new_state,
            "finalized": True,
            "status": c.status,
        }
    )

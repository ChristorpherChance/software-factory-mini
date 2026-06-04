"""委派编排服务（T-DLG-01/06）：HITL 闸门 + 脱敏 + 降级链 + 回流审计。"""
import time

from sqlalchemy.ext.asyncio import AsyncSession

from ..models.entities import DelegateAudit, Artifact, ArtifactVersion, PendingChange
from ..core.errors import AppError
from ..core.events import publish
from .redact import redact
from .fallback import with_fallback


async def delegate(
    db: AsyncSession,
    pid: str,
    session_id: str,
    target: str,
    payload: dict,
    hitl_mode: str = "Semi",
) -> dict:
    # 1) HITL 闸门：Manual/Semi 先生成 pending_change
    if hitl_mode in ("Manual", "Semi"):
        pc = PendingChange(
            project_id=pid,
            target_type="delegate",
            op="invoke",
            diff={"target": target, "payload_preview": redact(payload)},
            source_actor="agent:orchestrator",
            hitl_mode=hitl_mode,
        )
        db.add(pc)
        await db.commit()
        await db.refresh(pc)
        await publish(
            session_id,
            "hitl.request",
            {"pending_change_id": str(pc.id), "kind": "delegate", "count": 1},
        )
        if hitl_mode == "Manual":
            return {"status": "pending_approval", "pendingChangeId": str(pc.id)}

    # 2) 脱敏后调用（带降级链）
    safe_payload = redact(payload)
    audit = DelegateAudit(
        project_id=pid, session_id=session_id, target=target, request=safe_payload, status="running"
    )
    db.add(audit)
    await db.commit()
    await db.refresh(audit)
    t0 = time.time()
    try:
        result = await with_fallback(target, safe_payload)
    except Exception as e:  # noqa: BLE001
        audit.status, audit.response = "failed", {"error": str(e)}
        audit.latency_ms = int((time.time() - t0) * 1000)
        await db.commit()
        raise AppError(502, f"delegate failed: {e}", "DELEGATE_UPSTREAM_ERROR")

    audit.status, audit.response = "succeeded", result
    audit.latency_ms = int((time.time() - t0) * 1000)

    # 3) 结果回流为 delegate_result 工件
    art = Artifact(project_id=pid, type="delegate_result", title=f"{target} 结果", stage="requirement")
    db.add(art)
    await db.flush()
    db.add(
        ArtifactVersion(
            artifact_id=art.id, version=1, content=result.get("text", ""), author=f"delegate:{target}"
        )
    )
    await db.commit()
    await publish(
        session_id, "artifact.created", {"artifact_url": str(art.id), "kind": "delegate_result"}
    )
    return {
        "status": "succeeded",
        "auditId": str(audit.id),
        "artifactId": str(art.id),
        "latencyMs": audit.latency_ms,
        "text": result.get("text", ""),
    }

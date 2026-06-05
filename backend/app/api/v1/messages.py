"""消息 Message API（发送 → 触发编排 → SSE 流式）。"""
import asyncio
import json

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...deps import require_auth
from ...db import get_db, SessionLocal
from ...config import settings
from ...models.entities import Message, Session, SessionSettingOverride
from ...core.events import publish
from ...agents.orchestrator.state_machine import Orchestrator
from ...agents.requirement.generator import extract_edges
from ...services.settings import resolve_llm_endpoint
from ._common import ok, paged, idem_get, idem_put

router = APIRouter(tags=["messages"])


async def _pi_ws_stream(sid: str, user_text: str, aid: str) -> str:
    """Phase 2：消费 agent-service 的 WS token 真流式，逐 token publish。

    返回聚合后的完整文本。任何异常向上抛，由调用方回落假流式（铁律#3）。
    保持 publish payload 形状 {msg_id, delta, role}，不破坏前端 SSE 契约。
    """
    import httpx
    from httpx_ws import aconnect_ws

    headers = {"Authorization": f"Bearer {settings.auth_bearer_token}"}
    # 1) 确保子会话存在（用同一 sid，agent-service 内按 sid 持有 AgentSession）
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{settings.pi_base}/sessions",
            json={"session_id": sid},
            headers=headers,
        )
        r.raise_for_status()

    # 2) WS 消费 token 流
    buf = ""
    ws_url = f"{settings.pi_ws_base}/sessions/{sid}"
    async with aconnect_ws(ws_url, headers=headers) as ws:
        await ws.send_text(json.dumps({"type": "message", "content": user_text}))
        while True:
            raw = await ws.receive_text()
            ev = json.loads(raw)
            t = ev.get("type")
            if t == "message.delta":
                delta = ev.get("text", "")
                if delta:
                    buf += delta
                    await publish(sid, "message.delta", {"msg_id": aid, "delta": delta, "role": "assistant"})
            elif t == "tool.call":
                await publish(sid, "tool.call", ev)
            elif t == "hitl.request":
                await publish(sid, "hitl.request", ev)
            elif t == "stage.gate":
                await publish(sid, "stage.gate", ev)
            elif t == "message.end":
                break
    if not buf.strip():
        raise RuntimeError("pi WS produced empty stream")
    return buf


async def _pi_ws_generate(
    sid: str, kind: str, upstream: str, prompt_override: str | None, aid: str
) -> str:
    """文档生成（CRD/PRD/ORD）的真 token 流式：走 agent-service WS `generate` 通道。

    与 _pi_ws_stream 同构，但发送 {type:'generate', kind, upstream, systemPrompt}，
    使 agent-service 临时清空工具 + 覆写 systemPrompt（用户配置的 Agent），DeepSeek 逐 token 出文。
    返回聚合 markdown；空流或异常向上抛，由调用方回落本地编排（铁律#3）。
    """
    import httpx
    from httpx_ws import aconnect_ws

    headers = {"Authorization": f"Bearer {settings.auth_bearer_token}"}
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{settings.pi_base}/sessions", json={"session_id": sid}, headers=headers
        )
        r.raise_for_status()

    buf = ""
    ws_url = f"{settings.pi_ws_base}/sessions/{sid}"
    async with aconnect_ws(ws_url, headers=headers) as ws:
        await ws.send_text(
            json.dumps(
                {
                    "type": "generate",
                    "kind": kind,
                    "upstream": upstream,
                    "systemPrompt": prompt_override or "",
                }
            )
        )
        while True:
            ev = json.loads(await ws.receive_text())
            t = ev.get("type")
            if t == "message.delta":
                delta = ev.get("text", "")
                if delta:
                    buf += delta
                    await publish(
                        sid, "message.delta", {"msg_id": aid, "delta": delta, "role": "assistant"}
                    )
            elif t == "tool.call":
                await publish(sid, "tool.call", ev)
            elif t == "message.end":
                break
    if not buf.strip():
        raise RuntimeError("pi WS produced empty requirement")
    return buf


async def _pi_ws_edit(
    sid: str, current_doc: str, instruction: str, prompt_override: str | None, aid: str
) -> str:
    """定向编辑（问题5）真 token 流式：走 agent-service WS `edit` 通道，聚合修改后全文。

    关键修复：**不再把每个 token 作为 message.delta 推进对话框**（避免「改一处刷整篇」），
    edit 通道仅聚合完整 new_md 供上层建 pending；简短说明由调用方在建好 pending 后单独推送。
    返回完整修改后文档；空流/异常向上抛，由调用方回落（铁律#3）。"""
    import httpx
    from httpx_ws import aconnect_ws

    headers = {"Authorization": f"Bearer {settings.auth_bearer_token}"}
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{settings.pi_base}/sessions", json={"session_id": sid}, headers=headers
        )
        r.raise_for_status()

    buf = ""
    ws_url = f"{settings.pi_ws_base}/sessions/{sid}"
    async with aconnect_ws(ws_url, headers=headers) as ws:
        await ws.send_text(
            json.dumps(
                {
                    "type": "edit",
                    "currentDoc": current_doc,
                    "instruction": instruction,
                    "systemPrompt": prompt_override or "",
                }
            )
        )
        while True:
            ev = json.loads(await ws.receive_text())
            t = ev.get("type")
            if t == "message.delta":
                delta = ev.get("text", "")
                if delta:
                    buf += delta  # 仅聚合，不 publish 给前端（不刷整篇）
            elif t == "tool.call":
                await publish(sid, "tool.call", ev)
            elif t == "message.end":
                break
    if not buf.strip():
        raise RuntimeError("pi WS produced empty edit")
    return buf


def _dto(m: Message) -> dict:
    return {
        "id": str(m.id),
        "sessionId": str(m.session_id),
        "role": m.role,
        "content": m.content,
        "status": m.status,
        "createdAt": m.created_at.isoformat() if m.created_at else None,
    }


async def _has_model_override(db, sid: str) -> bool:
    """会话是否选了「会话级模型端点」（OpenAI 兼容或 anthropic）。

    Fix2：pi 模式下 agent-service WS 通道不认识会话级 model 选择，故选了端点就跳过 WS，
    改走本地 Orchestrator.handle（其按 _openai_chat(_stream)/anthropic 路由并逐 delta publish）。"""
    try:
        s = await db.get(Session, sid)
        pid = s.project_id if s else None
        if not pid:
            return False
        ov = (
            await db.execute(
                select(SessionSettingOverride).where(
                    SessionSettingOverride.session_id == sid,
                    SessionSettingOverride.category == "model",
                    SessionSettingOverride.key == "name",
                )
            )
        ).scalars().first()
        if not (ov and ov.value):
            return False
        name = ov.value if isinstance(ov.value, str) else (
            ov.value.get("name") if isinstance(ov.value, dict) else None
        )
        if not name:
            return False
        ep = await resolve_llm_endpoint(db, pid, name)
        prov = ep.get("provider")
        if prov == "anthropic" and ep.get("api_key"):
            return True
        return bool(ep.get("base_url") and prov not in (None, "stub", "pi"))
    except Exception:  # noqa: BLE001
        return False


async def _run_orchestrator(
    sid: str,
    user_text: str,
    hitl_mode: str | None,
    references: list[str] | None = None,
    target_type: str | None = None,
    target_artifact_id: str | None = None,
    quote: str | None = None,
):
    """后台任务：独立 DB session 跑编排，逐 token publish。

    provider=pi：先试 agent-service WS 真流式；失败回落本地编排假流式（铁律#3）。
    provider=stub/anthropic：走本地 Orchestrator 假流式（不变）。
    无论哪条路径，落库 + RTM + pending 由本地 Orchestrator 负责（pi 路径在 WS 后补跑薄监督器，见 Phase 3）。
    target_type/target_artifact_id：前端当前正在看的工件（crd/prd），供「对话定向编辑」定位目标。
    """
    async with SessionLocal() as db:
        assistant = Message(session_id=sid, role="assistant", content="", status="streaming")
        db.add(assistant)
        await db.commit()
        aid = str(assistant.id)
        buf = ""

        # Phase 2/3：pi 路径的薄监督器分流
        #  - 文档生成类意图（ord/crd/prd/parse_material）：走本地 Orchestrator.handle，
        #    它内部 generate_requirement 在 pi 模式下打 agent-service /requirement 出规范文档，
        #    并完成落库 Artifact/Version + RTM 边 + PendingChange（复用现有逻辑，零重写）。
        #  - 纯对话（chat）：走 agent-service WS 真 token 流式。
        # Fix2：若会话选了 OpenAI 兼容/anthropic 端点，跳过 pi WS，走下方本地 handle（模型选择生效）。
        use_local_model = await _has_model_override(db, sid)
        if settings.llm_provider == "pi" and not use_local_model:
            orch = Orchestrator(db)
            intent = orch._route(user_text)
            # 划选引用（问题3）：有引用片段则强制按定向编辑处理（parse_material 除外）。
            if quote and quote.strip() and intent != "parse_material":
                intent = "edit"
            if intent == "chat":
                try:
                    buf = await _pi_ws_stream(sid, user_text, aid)
                    assistant.content, assistant.status = buf, "completed"
                    await db.commit()
                    await publish(sid, "message.end", {"msg_id": aid, "finish_reason": "stop"})
                    return
                except Exception:  # noqa: BLE001
                    buf = ""  # WS 失败 → 回落假流式
            elif intent == "edit":
                # 对话定向编辑（问题2）：只改指定条目 → 切块 → 建 pending（不落新版本，按块确认后写回）。
                try:
                    pid, sess_hitl, _ = await orch._project_and_hitl(sid)
                    hitl = hitl_mode or sess_hitl
                    kind = (target_type or "crd").lower()
                    if kind not in ("crd", "prd", "ord"):
                        kind = "crd"
                    from ...services.artifact_helpers import latest_content, latest_artifact

                    old_md = await latest_content(db, pid, kind) if pid else ""
                    if not old_md.strip():
                        # 没有可编辑的文档 → 回落普通对话流式
                        raise RuntimeError("no document to edit")
                    # 取该 slot 的当前 Agent Prompt 作为领域提示词
                    prompt_override = None
                    try:
                        from ...services.prompt_resolve import load_active_prompts

                        prompt_override = (await load_active_prompts(db)).get(f"requirement.{kind}")
                    except Exception:  # noqa: BLE001
                        pass
                    # 划选引用（问题3）：把被引用原文拼进指令，约束模型只改这一段。
                    instr = user_text
                    if quote and quote.strip():
                        instr = f"（仅修改下面这段被引用的原文，其余逐字不变：{quote.strip()}）\n{user_text}"
                    new_md = await _pi_ws_edit(sid, old_md, instr, prompt_override, aid)
                    if new_md == old_md:
                        # 未定位到改动 → 回落本地 handle 给出指引（不整篇覆盖）
                        raise RuntimeError("edit produced no change")
                    # 定位目标工件 id（前端传的优先，否则取最新同类型）
                    tid = target_artifact_id
                    if not tid and pid:
                        art = await latest_artifact(db, pid, kind)
                        tid = str(art.id) if art else None
                    pc = None
                    if pid:
                        pc = await orch._save_edit_pending(
                            pid, kind, tid, old_md, new_md, sid, hitl
                        )
                    # 仅推送简短说明（不把整篇 new_md 刷进对话框，问题5）。
                    from ...agents.orchestrator.state_machine import _to_diff_blocks_update

                    n = (
                        len(pc.diff_blocks)
                        if (pc and pc.diff_blocks)
                        else len(_to_diff_blocks_update(old_md, new_md))
                    )
                    note = (
                        f"已在「{kind.upper()}」中定位并生成 {n} 处改动，"
                        "请在主区逐块确认（不会整篇覆盖原文）。"
                    )
                    await publish(
                        sid, "message.delta", {"msg_id": aid, "delta": note, "role": "assistant"}
                    )
                    assistant.content, assistant.status = note, "completed"
                    await db.commit()
                    await publish(sid, "message.end", {"msg_id": aid, "finish_reason": "stop"})
                    return
                except Exception:  # noqa: BLE001
                    buf = ""  # 失败 → 回落本地 handle
            elif intent in ("ord", "crd", "prd"):
                # 文档生成：真 token 流式（WS generate 通道）+ 复用本地落库逻辑。
                try:
                    pid, sess_hitl, _ = await orch._project_and_hitl(sid)
                    hitl = hitl_mode or sess_hitl
                    upstream = (
                        await orch._build_generation_upstream(pid, intent, references)
                        if pid
                        else user_text
                    )
                    # 注入用户在设置页配置的「当前 Agent Prompt」→ 覆写 agent-service systemPrompt
                    prompt_override = None
                    try:
                        from ...core.prompt_ctx import set_active_prompts
                        from ...services.prompt_resolve import load_active_prompts

                        prompts = await load_active_prompts(db)
                        set_active_prompts(prompts)
                        prompt_override = prompts.get(f"requirement.{intent}")
                    except Exception:  # noqa: BLE001
                        pass
                    buf = await _pi_ws_generate(
                        sid, intent, upstream or user_text, prompt_override, aid
                    )
                    if pid:
                        await orch._save_requirement(
                            pid,
                            intent,
                            {"markdown": buf, "edges": extract_edges(buf)},
                            sid,
                            hitl,
                        )
                    assistant.content, assistant.status = buf, "completed"
                    await db.commit()
                    await publish(sid, "message.end", {"msg_id": aid, "finish_reason": "stop"})
                    return
                except Exception:  # noqa: BLE001
                    buf = ""  # WS/生成失败 → 回落本地 handle（阻塞假流式或 stub）
            # 其它意图或上面回落：落到下方 Orchestrator.handle（薄监督器，含落库）

        try:
            n = 0  # 协作式取消（问题5）：每若干段回查本消息状态，被置 cancelled 即停。
            async for delta in Orchestrator(db).handle(
                sid, user_text, hitl_mode, references, target_type, target_artifact_id, quote
            ):
                # 推理模型思考链：("reasoning", text) → 单独推到前端折叠区，不计入消息正文/落库
                if isinstance(delta, tuple) and delta and delta[0] == "reasoning":
                    await publish(
                        sid,
                        "message.delta",
                        {"msg_id": aid, "delta": delta[1], "role": "assistant", "channel": "reasoning"},
                    )
                    continue
                buf += delta
                await publish(
                    sid,
                    "message.delta",
                    {"msg_id": aid, "delta": delta, "role": "assistant"},
                )
                n += 1
                if n % 5 == 0:
                    # 重新读取本 assistant 消息状态：cancel 端点置 cancelled → 协作停止。
                    await db.refresh(assistant)
                    if assistant.status == "cancelled":
                        assistant.content = buf  # 保留已输出内容
                        await db.commit()
                        await publish(
                            sid, "message.end", {"msg_id": aid, "finish_reason": "cancelled"}
                        )
                        return
            # 收尾再判一次：避免最后几段后被取消却仍标 completed。
            await db.refresh(assistant)
            if assistant.status == "cancelled":
                assistant.content = buf
                await db.commit()
                await publish(sid, "message.end", {"msg_id": aid, "finish_reason": "cancelled"})
                return
            assistant.content, assistant.status = buf, "completed"
            await db.commit()
            await publish(sid, "message.end", {"msg_id": aid, "finish_reason": "stop"})
        except Exception as e:  # noqa: BLE001
            assistant.content = buf + f"\n[编排出错] {e}"
            assistant.status = "error"
            await db.commit()
            await publish(sid, "message.end", {"msg_id": aid, "finish_reason": "error"})


@router.post("/sessions/{sid}/messages")
async def send(
    sid: str,
    body: dict,
    idem: str | None = Header(default=None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_auth),
):
    cached = idem_get(idem)
    if cached:
        return cached
    # 透传/记忆 HITL 档到会话
    hitl = body.get("hitlMode")
    if hitl:
        s = await db.get(Session, sid)
        if s:
            s.hitl_mode = hitl
            await db.commit()
    m = Message(
        session_id=sid,
        role="user",
        content=body["content"],
        attachments=body.get("attachments", []),
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    references = body.get("references") or None
    target_type = body.get("targetType")
    target_artifact_id = body.get("targetArtifactId")
    quote = body.get("quote") or None  # 划选引用片段（问题3）：据此走定向最小改动。
    asyncio.create_task(
        _run_orchestrator(
            sid, body["content"], hitl, references, target_type, target_artifact_id, quote
        )
    )
    return idem_put(idem, ok(_dto(m)))


@router.get("/sessions/{sid}/messages")
async def lst(sid: str, limit: int = 100, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    q = select(Message).where(Message.session_id == sid).order_by(Message.created_at).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return paged([_dto(m) for m in rows], limit=limit)


@router.post("/sessions/{sid}/messages/{mid}/cancel")
async def cancel(sid: str, mid: str, db: AsyncSession = Depends(get_db), _=Depends(require_auth)):
    m = await db.get(Message, mid)
    if m and m.status == "streaming":
        m.status = "cancelled"
        await db.commit()
    return ok({"cancelled": True})

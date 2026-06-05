"""LLM Provider 抽象（方案甲：Pi 多 provider，可换不锁死）。

- ``stub``（默认）：离线、确定性。资料结构化按文本特征产出稳定 JSON（双跑 sha256 一致），
  需求三件套按上游内容模板化生成带编号与「上溯」行的 Markdown。让本地零密钥即可跑通
  POC-1 / 端到端，不依赖外网。
- ``anthropic``：真实调用 Claude（设 LLM_PROVIDER=anthropic + LLM_API_KEY）。

两种 provider 暴露同一接口：
    await structure_material(text) -> dict        # 资料结构化
    await generate_requirement(kind, upstream) -> str   # 三件套 Markdown
"""
import re
import hashlib
import json

from ..config import settings
from .prompt_ctx import get_active_prompt

# 资料结构化输出 schema（骨架 §5.2 / M1 §7.3）
MATERIAL_SCHEMA = {
    "type": "object",
    "required": [
        "summary",
        "key_points",
        "quotes",
        "tags",
        "readiness_score",
        "readiness_dimensions",
        "missing_items",
    ],
    "properties": {
        "summary": {"type": "string", "maxLength": 300},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "quotes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "anchor": {
                        "type": "object",
                        "properties": {
                            "page": {"type": "integer"},
                            "line": {"type": "integer"},
                            "offset": {"type": "integer"},
                        },
                    },
                },
            },
        },
        "tags": {"type": "array", "items": {"type": "string"}},
        "readiness_score": {"type": "number"},
        "readiness_dimensions": {"type": "object"},
        "missing_items": {"type": "array", "items": {"type": "string"}},
    },
}

DIMS = ["business_goal", "user_persona", "key_flow", "constraints", "success_criteria"]

# 维度命中关键词（中英混排），用于确定性就绪度评分
_DIM_KEYWORDS = {
    "business_goal": ["目标", "业务", "goal", "objective", "愿景", "价值"],
    "user_persona": ["用户", "客户", "角色", "user", "persona", "受众"],
    "key_flow": ["流程", "步骤", "flow", "用例", "场景", "功能"],
    "constraints": ["约束", "限制", "constraint", "非功能", "性能", "安全", "合规"],
    "success_criteria": ["验收", "成功", "指标", "criteria", "success", "kpi", "完成"],
}

MATERIAL_SYSTEM = "你是资料解析器。仅输出符合 schema 的结构化结果，不输出多余文字。"


# ---------------------------------------------------------------------------
# stub provider（确定性、离线）
# ---------------------------------------------------------------------------
def _stub_structure(text: str) -> dict:
    text = text or ""
    # 句子切分（中英标点）
    raw = re.split(r"(?<=[。！？.!?\n])", text)
    sentences = [s.strip() for s in raw if s.strip()]
    key_points = sentences[:5]

    # quotes：取前 3 句并给出稳定锚点（按行号定位）
    lines = text.splitlines()
    quotes = []
    for i, sent in enumerate(sentences[:3]):
        line_no = next((ln + 1 for ln, content in enumerate(lines) if sent[:8] and sent[:8] in content), i + 1)
        quotes.append(
            {"text": sent[:120], "anchor": {"page": 1, "line": line_no, "offset": 0}}
        )

    low = text.lower()
    dims: dict[str, float] = {}
    for dim, kws in _DIM_KEYWORDS.items():
        hits = sum(1 for kw in kws if kw.lower() in low)
        dims[dim] = round(min(1.0, hits / 2.0), 3)  # 命中 2 个关键词即满分

    missing = [d for d in DIMS if dims.get(d, 0.0) < 0.5]
    score = round(sum(dims.values()) / len(DIMS), 3)

    # tags：取最高频的若干中文/英文词
    words = re.findall(r"[一-龥]{2,4}|[A-Za-z]{3,}", text)
    freq: dict[str, int] = {}
    for w in words:
        freq[w] = freq.get(w, 0) + 1
    tags = [w for w, _ in sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[:5]]

    summary = (sentences[0][:120] if sentences else "（空白资料）")
    return {
        "summary": summary,
        "key_points": key_points,
        "quotes": quotes,
        "tags": tags,
        "readiness_score": score,
        "readiness_dimensions": dims,
        "missing_items": missing,
    }


def _salient_points(text: str, n: int) -> list[str]:
    """从上游/参考资料文本中抽取若干要点（标题/列表项/句子），跳过脚手架标题。"""
    pts: list[str] = []
    seen: set[str] = set()
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith("#") and ("参考资料" in s or "上游" in s):
            continue  # 跳过 "# 参考资料" / "## 参考资料：xxx" / "# 上游 ORD" 等脚手架
        if s.startswith(("<", "|", "```")):
            continue  # 跳过 HTML 片段（如 <aside>）/表格/代码围栏
        m = re.match(r"^#{1,6}\s+(.*)$", s) or re.match(r"^[-*]\s+(.*)$", s)
        cand = (m.group(1) if m else s)
        cand = re.sub(r"[*`>]+", "", cand).strip(" :：-#。.")
        if len(cand) < 4:
            continue
        cand = cand[:60]
        if cand in seen:
            continue
        seen.add(cand)
        pts.append(cand)
        if len(pts) >= n:
            break
    return pts


def _stub_requirement(kind: str, upstream: str) -> str:
    kind = kind.lower()
    digest = hashlib.sha256((kind + upstream).encode()).hexdigest()[:6]
    upstream = upstream or ""

    if kind == "ord":
        # 从资料文本抽取若干原始诉求点 → R-00x
        pts = [s.strip(" -*#\t") for s in re.split(r"[\n。！？.!?]", upstream)]
        pts = [p for p in pts if len(p) > 1][:3] or ["核心诉求一", "核心诉求二"]
        body = [
            "# 原始需求文档 ORD",
            "## 背景",
            f"基于已解析资料（指纹 {digest}）整理原始诉求。",
            "## 目标",
            "明确用户原始期望，作为后续 CRD/PRD 的源头。",
            "## 原始诉求",
        ]
        for i, p in enumerate(pts, 1):
            body.append(f"- R-{i:03d} {p}")
        return "\n".join(body)

    if kind == "crd":
        # 有上游 ORD（含 R 编号）：1:1 派生 CR，保证完整追溯链。
        rcodes = sorted(set(re.findall(r"R-\d+", upstream)), key=lambda c: int(c.split("-")[1]))
        body = ["# 客户需求文档 CRD", "## 客户需求"]
        if rcodes:
            for i, rc in enumerate(rcodes, 1):
                body.append(f"- CR-{i:03d} 客户需求项 {i}（上溯：{rc}）")
        else:
            # 无 ORD：直接从参考资料要点派生 CR，上溯标注「资料」。
            pts = _salient_points(upstream, 6)
            if pts:
                for i, p in enumerate(pts, 1):
                    body.append(f"- CR-{i:03d} {p}（上溯：资料）")
            else:
                body.append("-（暂无参考资料或上游：请先在资料阶段定稿参考资料后再生成）")
        body += ["## 验收标准", "- 每条客户需求均可被 PRD 功能点覆盖且可验证。"]
        return "\n".join(body)

    # prd：从 CRD 抽取 CR 编号 → 每条派生一条 PRD-F，并补一条 PRD-NFR
    crcodes = sorted(set(re.findall(r"CR-\d+", upstream)), key=lambda c: int(c.split("-")[1]))
    body = ["# 产品需求文档 PRD", "## 功能需求"]
    if crcodes:
        for i, cc in enumerate(crcodes, 1):
            body.append(f"- PRD-F-{i:03d} 功能点 {i}（上溯：{cc}）")
    else:
        pts = _salient_points(upstream, 6)
        for i, p in enumerate(pts or ["功能点 1"], 1):
            body.append(f"- PRD-F-{i:03d} {p}（上溯：CR-001）")
    nfr_up = (crcodes or ["CR-001"])[0]
    body += [
        "## 非功能需求",
        f"- PRD-NFR-001 系统可在本地单机运行（上溯：{nfr_up}）。",
        "## 验收",
        "- 三件套自检全绿且 RTM 覆盖率≥0.85 方可定稿。",
    ]
    return "\n".join(body)


# ---------------------------------------------------------------------------
# anthropic provider（真实）
# ---------------------------------------------------------------------------
async def _anthropic_structure(text: str, session_id: str | None = None) -> dict:
    """资料结构化（带 M4 P1-B tool.call SSE 推送）。"""
    import time
    import uuid

    from anthropic import AsyncAnthropic
    from .events import publish

    client = AsyncAnthropic(api_key=settings.llm_api_key)
    call_id = str(uuid.uuid4())
    t0 = time.monotonic()
    if session_id:
        await publish(
            session_id,
            "tool.call",
            {
                "id": call_id,
                "name": "emit · material_parse",
                "status": "running",
                "input_preview": f"{text[:60]}…" if len(text) > 60 else text,
                "hitl": False,
            },
        )
    try:
        resp = await client.messages.create(
            model=settings.llm_model,
            max_tokens=4096,
            temperature=0,
            top_p=1,
            # 当前绑定 Prompt（设置页配置）优先，回落系统默认
            system=get_active_prompt("material.file_parse") or MATERIAL_SYSTEM,
            tools=[
                {
                    "name": "emit",
                    "description": "emit parsed material",
                    "input_schema": MATERIAL_SCHEMA,
                }
            ],
            tool_choice={"type": "tool", "name": "emit"},
            messages=[{"role": "user", "content": text[:120000]}],
        )
        for b in resp.content:
            if b.type == "tool_use":
                duration_ms = int((time.monotonic() - t0) * 1000)
                tokens = getattr(getattr(resp, "usage", None), "output_tokens", None)
                if session_id:
                    await publish(
                        session_id,
                        "tool.call",
                        {
                            "id": call_id,
                            "name": "emit · material_parse",
                            "status": "ok",
                            "duration_ms": duration_ms,
                            "tokens": tokens,
                        },
                    )
                return b.input
        raise RuntimeError("no structured output")
    except Exception as e:
        if session_id:
            await publish(
                session_id,
                "tool.call",
                {
                    "id": call_id,
                    "name": "emit · material_parse",
                    "status": "error",
                    "duration_ms": int((time.monotonic() - t0) * 1000),
                    "error": str(e)[:120],
                },
            )
        raise


_REQ_PROMPT = {
    "ord": "基于资料结构化结果生成原始需求文档 ORD，每条需求带 R-* 编号并注明上溯资料引用。",
    "crd": "基于 ORD 生成客户需求文档 CRD，每条带 CR-* 编号并以「上溯：R-*」标注来源。",
    "prd": "基于 CRD 生成 PRD，每条带 PRD-F-*/PRD-NFR-* 编号并以「上溯：CR-*」标注来源。",
}


async def _anthropic_requirement(kind: str, upstream: str, session_id: str | None = None) -> str:
    """需求 markdown 生成（带 M4 P1-B tool.call SSE 推送）。"""
    import time
    import uuid

    from anthropic import AsyncAnthropic
    from .events import publish

    client = AsyncAnthropic(api_key=settings.llm_api_key)
    call_id = str(uuid.uuid4())
    t0 = time.monotonic()
    if session_id:
        await publish(
            session_id,
            "tool.call",
            {
                "id": call_id,
                "name": f"messages.create · {kind}",
                "status": "running",
                "input_preview": f"{upstream[:60]}…" if len(upstream) > 60 else upstream,
                "hitl": False,
            },
        )
    try:
        resp = await client.messages.create(
            model=settings.llm_model,
            max_tokens=8192,
            temperature=0.2,
            # 当前绑定 Prompt（设置页配置）优先，回落系统默认
            system=get_active_prompt(f"requirement.{kind.lower()}") or _REQ_PROMPT[kind.lower()],
            messages=[{"role": "user", "content": upstream}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text")
        if session_id:
            tokens = getattr(getattr(resp, "usage", None), "output_tokens", None)
            await publish(
                session_id,
                "tool.call",
                {
                    "id": call_id,
                    "name": f"messages.create · {kind}",
                    "status": "ok",
                    "duration_ms": int((time.monotonic() - t0) * 1000),
                    "tokens": tokens,
                },
            )
        return text
    except Exception as e:
        if session_id:
            await publish(
                session_id,
                "tool.call",
                {
                    "id": call_id,
                    "name": f"messages.create · {kind}",
                    "status": "error",
                    "duration_ms": int((time.monotonic() - t0) * 1000),
                    "error": str(e)[:120],
                },
            )
        raise


# ---------------------------------------------------------------------------
# pi provider（内嵌 pi-agent-core 的 agent-service，HTTP 调用）
# 铁律#3：任何异常都回落 _stub_*，绝不让请求 500。
# ---------------------------------------------------------------------------
_PI_TIMEOUT = 120


async def _pi_structure(text: str) -> dict:
    import httpx

    async with httpx.AsyncClient(timeout=_PI_TIMEOUT) as c:
        r = await c.post(
            f"{settings.pi_base}/structure",
            json={
                "text": text,
                "session_id": None,
                # 当前绑定 Prompt（设置页配置）覆写 agent-service systemPrompt
                "prompt_override": get_active_prompt("material.file_parse"),
            },
            headers={"Authorization": f"Bearer {settings.auth_bearer_token}"},
        )
        r.raise_for_status()
        return r.json()["data"]


async def _pi_requirement(kind: str, upstream: str) -> str:
    import httpx

    async with httpx.AsyncClient(timeout=_PI_TIMEOUT) as c:
        r = await c.post(
            f"{settings.pi_base}/requirement",
            json={
                "kind": kind,
                "upstream": upstream,
                "session_id": None,
                # 当前绑定 Prompt（设置页配置）覆写 agent-service systemPrompt
                "prompt_override": get_active_prompt(f"requirement.{kind.lower()}"),
            },
            headers={"Authorization": f"Bearer {settings.auth_bearer_token}"},
        )
        r.raise_for_status()
        return r.json()["data"]["markdown"]


# ---------------------------------------------------------------------------
# 统一入口
# ---------------------------------------------------------------------------
async def structure_material(text: str, session_id: str | None = None) -> dict:
    if settings.llm_provider == "pi":
        # Phase 3：资料结构化暂用确定性 stub（可靠落库 + 给 ORD 提供稳定上游）。
        # 资料结构化的 LLM 化（agent-service /structure + parse_material 工具）是 Phase 5 范围，
        # 届时 _pi_structure 接 Pi 内核 + tooling 抽取后再切回。
        try:
            d = await _pi_structure(text)
            # 校验返回含必需字段，否则回落 stub（避免 {_raw} 占位污染落库）
            if isinstance(d, dict) and "readiness_score" in d:
                return d
            return _stub_structure(text)
        except Exception:
            return _stub_structure(text)  # 离线兜底（铁律#3）
    if settings.llm_provider == "anthropic" and settings.llm_api_key:
        return await _anthropic_structure(text, session_id=session_id)
    return _stub_structure(text)


async def generate_requirement(kind: str, upstream: str, session_id: str | None = None) -> str:
    if settings.llm_provider == "pi":
        try:
            return await _pi_requirement(kind, upstream)
        except Exception:
            return _stub_requirement(kind, upstream)  # 离线兜底（铁律#3）
    if settings.llm_provider == "anthropic" and settings.llm_api_key:
        return await _anthropic_requirement(kind, upstream, session_id=session_id)
    return _stub_requirement(kind, upstream)


def _stub_beautify(draft: str) -> str:
    """离线兜底：把草稿包进规范提示词骨架（不调 LLM，确定性）。"""
    draft = (draft or "").strip() or "（空）"
    return (
        "# 角色\n你是需求文档生成 Agent。\n\n"
        "# 职责\n根据上游输入生成规范的需求文档。\n\n"
        "# 用户要求\n" + draft + "\n\n"
        "# 输出格式\n"
        "- 用 Markdown，#/## 分节；\n"
        "- 每条需求带编号，下游条目以「（上溯：<上游编号 或 资料>）」标注来源；\n"
        "- 仅输出文档正文，不要解释。\n"
    )


async def _pi_beautify(draft: str) -> str:
    import httpx

    async with httpx.AsyncClient(timeout=_PI_TIMEOUT) as c:
        r = await c.post(
            f"{settings.pi_base}/beautify",
            json={"draft": draft, "session_id": None},
            headers={"Authorization": f"Bearer {settings.auth_bearer_token}"},
        )
        r.raise_for_status()
        return r.json()["data"]["content"]


async def beautify_prompt(draft: str) -> str:
    """美化提示词（问题1）：pi 调 agent-service /beautify；其它 provider 回落 stub 模板。"""
    if settings.llm_provider == "pi":
        try:
            out = await _pi_beautify(draft)
            return out if (out and out.strip()) else _stub_beautify(draft)
        except Exception:
            return _stub_beautify(draft)
    return _stub_beautify(draft)


def _stub_edit(current_doc: str, instruction: str) -> str:
    """离线兜底的定向编辑（问题2）：解析「把 <编号> 改成/为 <新文案>」，只替换该条整行。

    支持：改成/改为/替换为 → 替换该编号行标题；删除 <编号> → 删除该行。其余原样返回。
    确定性、无 LLM，保证 stub/CI 可跑通按块 diff。
    """
    import re as _re

    code_pat = r"(R-\d+|CR-\d+|PRD-[A-Z]+-\d+|PRD-\d+)"
    m_code = _re.search(code_pat, instruction)
    if not m_code:
        return current_doc  # 没识别到编号，不改（上层据 old==new 不建 pending）
    code = m_code.group(1)
    lines = current_doc.splitlines()

    # 删除意图
    if any(k in instruction for k in ("删除", "去掉")):
        out = [ln for ln in lines if not _re.search(rf"\b{_re.escape(code)}\b", ln)]
        return "\n".join(out)

    # 替换意图：取「改成/改为/替换为/为」之后的文案
    m_new = _re.search(r"(?:改成|改为|替换为|更新为|为)\s*[:：]?\s*(.+)$", instruction)
    new_text = m_new.group(1).strip() if m_new else None
    out = []
    for ln in lines:
        if _re.search(rf"\b{_re.escape(code)}\b", ln) and new_text:
            # 保留「- <编号> 」前缀与「（上溯：…）」后缀，仅替换中间标题
            m_up = _re.search(r"（上溯[:：][^）]*）", ln)
            suffix = m_up.group(0) if m_up else ""
            out.append(f"- {code} {new_text}{suffix}")
        else:
            out.append(ln)
    return "\n".join(out)


async def _pi_edit(current_doc: str, instruction: str, prompt_override: str | None) -> str:
    """pi 非流式编辑兜底（流式走 messages._pi_ws_edit；此处供回落/同步调用）。"""
    import httpx

    sys = (
        "你是需求文档编辑器。只按指令修改对应条目，保持其它所有内容逐字不变，"
        "输出完整的修改后文档（Markdown）。" + (f"\n领域提示词：{prompt_override}" if prompt_override else "")
    )
    async with httpx.AsyncClient(timeout=_PI_TIMEOUT) as c:
        r = await c.post(
            f"{settings.pi_base}/requirement",
            json={
                "kind": "crd",
                "upstream": f"【当前完整文档】\n{current_doc}\n\n【修改指令】\n{instruction}",
                "session_id": None,
                "prompt_override": sys,
            },
            headers={"Authorization": f"Bearer {settings.auth_bearer_token}"},
        )
        r.raise_for_status()
        return r.json()["data"]["markdown"]


async def edit_requirement(
    current_doc: str, instruction: str, prompt_override: str | None = None
) -> str:
    """定向编辑（问题2）非流式入口：pi 调 agent-service；其它回落 stub。"""
    if settings.llm_provider == "pi":
        try:
            out = await _pi_edit(current_doc, instruction, prompt_override)
            return out if (out and out.strip()) else _stub_edit(current_doc, instruction)
        except Exception:
            return _stub_edit(current_doc, instruction)
    return _stub_edit(current_doc, instruction)

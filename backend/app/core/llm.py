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
        # 从 ORD 抽取 R 编号 → 每条派生一条 CR（保证 1:1 完整追溯链）
        rcodes = sorted(set(re.findall(r"R-\d+", upstream)), key=lambda c: int(c.split("-")[1]))
        rcodes = rcodes or ["R-001", "R-002"]
        body = ["# 客户需求文档 CRD", "## 客户需求"]
        for i, rc in enumerate(rcodes, 1):
            body.append(f"- CR-{i:03d} 客户需求项 {i}（上溯：{rc}）")
        body += ["## 验收标准", "- 每条客户需求均可被 PRD 功能点覆盖且可验证。"]
        return "\n".join(body)

    # prd：从 CRD 抽取 CR 编号 → 每条派生一条 PRD-F，并补一条 PRD-NFR
    crcodes = sorted(set(re.findall(r"CR-\d+", upstream)), key=lambda c: int(c.split("-")[1]))
    crcodes = crcodes or ["CR-001", "CR-002"]
    body = ["# 产品需求文档 PRD", "## 功能需求"]
    for i, cc in enumerate(crcodes, 1):
        body.append(f"- PRD-F-{i:03d} 功能点 {i}（上溯：{cc}）")
    body += [
        "## 非功能需求",
        f"- PRD-NFR-001 系统可在本地单机运行（上溯：{crcodes[0]}）。",
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
            system=MATERIAL_SYSTEM,
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
            system=_REQ_PROMPT[kind.lower()],
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
            json={"text": text, "session_id": None},
            headers={"Authorization": f"Bearer {settings.auth_bearer_token}"},
        )
        r.raise_for_status()
        return r.json()["data"]


async def _pi_requirement(kind: str, upstream: str) -> str:
    import httpx

    async with httpx.AsyncClient(timeout=_PI_TIMEOUT) as c:
        r = await c.post(
            f"{settings.pi_base}/requirement",
            json={"kind": kind, "upstream": upstream, "session_id": None},
            headers={"Authorization": f"Bearer {settings.auth_bearer_token}"},
        )
        r.raise_for_status()
        return r.json()["data"]["markdown"]


# ---------------------------------------------------------------------------
# 统一入口
# ---------------------------------------------------------------------------
async def structure_material(text: str, session_id: str | None = None) -> dict:
    if settings.llm_provider == "pi":
        try:
            return await _pi_structure(text)
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

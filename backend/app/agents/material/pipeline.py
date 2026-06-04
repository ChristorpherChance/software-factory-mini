"""资料解析管线（串联全管线 + 缓存 + 进度事件）。

输入(源)→类型识别→抽取→LLM 结构化(双跑一致)→就绪度→返回结构化结果。
返回结果将由编排/路由入库为 artifact(type='material_parsed')。
"""
import hashlib

from .detect import detect_type
from .extract import extract_text
from .structure import llm_structure
from .consistency import double_run_consistent
from .readiness import score_readiness
from ...core.events import publish

_cache: dict[str, dict] = {}


async def parse_material(source: str, session_id: str | None = None) -> dict:
    kind = detect_type(source)
    text = await extract_text(source, kind)
    key = hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest()
    if key in _cache:
        return _cache[key]
    if session_id:
        await publish(
            session_id, "task.update", {"task_id": key[:8], "status": "running", "progress": 40}
        )
    # stub 路径严判 sha256；pi 路径（LLM 非确定）转结构近似比对
    from ...config import settings

    _mode = "approx" if settings.llm_provider == "pi" else "strict"
    structured = await double_run_consistent(
        lambda: llm_structure(text, session_id=session_id), mode=_mode
    )
    (
        structured["readiness_score"],
        structured["readiness_dimensions"],
        structured["missing_items"],
    ) = score_readiness(structured)
    structured["rule_version"] = "v0.1"
    structured["source_kind"] = kind
    if session_id:
        await publish(
            session_id,
            "task.update",
            {"task_id": key[:8], "status": "succeeded", "progress": 100},
        )
    _cache[key] = structured
    return structured

"""LLM 结构化（T-MAT-02 · 经 core.llm provider，默认 stub 确定性 · M4 P1-B 透传 session_id）。"""
from ...core.llm import structure_material, MATERIAL_SCHEMA  # noqa: F401  (schema 供测试引用)


async def llm_structure(text: str, session_id: str | None = None) -> dict:
    return await structure_material(text, session_id=session_id)

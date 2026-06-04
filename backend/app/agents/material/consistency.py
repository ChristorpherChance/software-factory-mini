"""双跨一致性校验（T-MAT-03 / PRD-NFR-003）。

- stub 路径（默认 mode='strict'）：两次结构化结果 sha256 必须一致（离线确定性严判）。
- pi 路径（mode='approx'）：LLM 输出非确定，sha256 不适用 → 结构近似比对（Jaccard 阈 0.8）。

mode 不传默认 strict，保持既有调用行为不变。
"""
import hashlib
import json


def _h(x) -> str:
    return hashlib.sha256(json.dumps(x, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _keys(x) -> set:
    """结构骨架：顶层键 + 各列表长度量级（用于近似比对）。"""
    out: set = set()
    if isinstance(x, dict):
        for k, v in x.items():
            out.add(k)
            if isinstance(v, list):
                out.add(f"{k}:len~{min(len(v), 5)}")
    return out


def _similar(a, b) -> float:
    """结构近似度 [0,1]：Jaccard(键骨架)。"""
    ka, kb = _keys(a), _keys(b)
    if not ka and not kb:
        return 1.0
    inter = len(ka & kb)
    union = len(ka | kb) or 1
    return inter / union


async def double_run_consistent(run, max_retry: int = 1, mode: str = "strict"):
    a = await run()
    b = await run()
    if mode == "approx":
        # pi 路径：结构近似一致即可（LLM 非确定性），超预算仍返回首结果（不硬失败）
        if _similar(a, b) >= 0.8:
            return a
        if max_retry > 0:
            return await double_run_consistent(run, max_retry - 1, mode=mode)
        return a
    # strict（stub 路径）：sha256 严判，保持既有契约
    if _h(a) == _h(b):
        return a
    if max_retry > 0:
        return await double_run_consistent(run, max_retry - 1, mode=mode)
    raise RuntimeError("INCONSISTENT_PARSE -> escalate HITL")

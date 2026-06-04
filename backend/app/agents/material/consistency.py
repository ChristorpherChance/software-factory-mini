"""双跨一致性校验（T-MAT-03 / PRD-NFR-003）。

两次结构化结果 sha256 不一致则重试，超预算升级 HITL。
"""
import hashlib
import json


def _h(x) -> str:
    return hashlib.sha256(json.dumps(x, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


async def double_run_consistent(run, max_retry: int = 1):
    a = await run()
    b = await run()
    if _h(a) == _h(b):
        return a
    if max_retry > 0:
        return await double_run_consistent(run, max_retry - 1)
    raise RuntimeError("INCONSISTENT_PARSE -> escalate HITL")

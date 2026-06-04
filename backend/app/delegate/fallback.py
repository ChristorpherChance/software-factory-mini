"""失败降级链（T-DLG-07）。

优先级降级：外接不可达自动回落，最终回落 generic_http(mock) 保证环路不崩。
"""
from .registry import resolve_target
from ..agents.orchestrator.policy import run_with_policy, RetryPolicy

CHAIN = {
    "pi_subsession": ["pi_subsession", "generic_http_agent"],
    "claude_code": ["claude_code", "pi_subsession", "generic_http_agent"],
    "generic_http_agent": ["generic_http_agent"],
}


async def with_fallback(target: str, payload: dict) -> dict:
    errors = []
    for name in CHAIN.get(target, [target]):
        tgt = resolve_target(name)
        try:
            return await run_with_policy(
                lambda t=tgt: t.invoke(payload), RetryPolicy(max_attempts=2)
            )
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")
    raise RuntimeError(" | ".join(errors))

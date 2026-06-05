"""活跃 Agent Prompt 的上下文注入（slot → 当前 Prompt 文本）。

编排在请求边界 set_active_prompts；core/llm 的 provider 入口只读 get_active_prompt，
从而无需把 db/pid 透传进纯函数层。contextvar 随 asyncio 任务上下文自然传递。

注意：stub provider 忽略外部 prompt（纯算法模板），故配置仅在 anthropic/pi 下可见生效。
"""
import contextvars

_active: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "active_agent_prompts", default=None
)


def set_active_prompts(prompts: dict[str, str] | None) -> None:
    _active.set(prompts or {})


def get_active_prompt(slot: str) -> str | None:
    """返回该 slot 的当前 Prompt（无配置或空白则 None，调用方回落默认）。"""
    d = _active.get()
    if not d:
        return None
    v = d.get(slot)
    return v if (v and v.strip()) else None


def clear_active_prompts() -> None:
    _active.set(None)

"""活跃 LLM 端点（模型选择）的上下文注入（会话级覆盖 → 解析出的端点）。

仿 prompt_ctx：编排在请求边界 set_active_model（据会话级 model.name 覆盖 resolve 出端点
dict：{provider, base_url, model, api_key}）；core/llm 的统一入口只读 get_active_model，
据此路由到对应 provider（OpenAI 兼容 / anthropic），无需把 db/pid 透传进纯函数层。
contextvar 随 asyncio 任务上下文自然传递。

注意：未配置任何端点或调用失败时，core/llm 仍回落确定性 stub（离线可跑，铁律#3）。
"""
import contextvars

_active_model: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "active_llm_model", default=None
)


def set_active_model(endpoint: dict | None) -> None:
    """注入当前会话选中的端点 dict（None 表示无会话级覆盖，走默认分流）。"""
    _active_model.set(endpoint or None)


def get_active_model() -> dict | None:
    """返回当前会话选中的端点 dict；无则 None（调用方回落默认 provider 分流）。"""
    return _active_model.get()


def clear_active_model() -> None:
    _active_model.set(None)

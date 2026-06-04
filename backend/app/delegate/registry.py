"""委派 target 注册中心（方案 C target 注册）。"""
from .pi_native import PiSubsessionTarget
from .claude_code import ClaudeCodeTarget
from .generic_http import GenericHttpTarget

_TARGETS = {
    t.name: t
    for t in [PiSubsessionTarget(), ClaudeCodeTarget(), GenericHttpTarget("mock")]
}


def resolve_target(name: str):
    if name not in _TARGETS:
        raise KeyError(f"unknown target {name}")
    return _TARGETS[name]


def list_targets() -> list[str]:
    return list(_TARGETS.keys())

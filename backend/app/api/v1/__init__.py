"""api/v1 子包：聚合所有路由。"""
from fastapi import APIRouter

from . import (
    projects,
    sessions,
    messages,
    materials,
    artifacts,
    tasks,
    pending_changes,
    stage_gates,
    rtm,
    settings,
    delegate,
    selfcheck,
    notifications,
    files,
    internal,
    capability,
    agent_prompts,
)

router = APIRouter()
for _m in (
    projects,
    sessions,
    messages,
    materials,
    artifacts,
    tasks,
    pending_changes,
    stage_gates,
    rtm,
    settings,
    delegate,
    selfcheck,
    notifications,
    files,
    internal,
    capability,
    agent_prompts,
):
    router.include_router(_m.router)

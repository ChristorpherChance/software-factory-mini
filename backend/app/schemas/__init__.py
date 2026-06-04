"""pydantic v2 I/O 契约（统一 data/meta 在路由层包裹）。"""
from pydantic import BaseModel
from typing import Any, Literal

Hitl = Literal["Auto", "Semi", "Manual"]


class ProjectIn(BaseModel):
    name: str
    description: str | None = None
    template: str | None = None


class ProjectPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    current_stage: str | None = None
    hitl_mode: Hitl | None = None


class SessionIn(BaseModel):
    title: str | None = None
    stage: str | None = None
    agent: str | None = None
    hitlMode: Hitl | None = None


class MessageIn(BaseModel):
    role: Literal["user"] = "user"
    content: str
    attachments: list[str] = []
    hitlMode: Hitl | None = None


class ArtifactIn(BaseModel):
    type: str
    title: str
    stage: str | None = None
    content: str | None = None
    author: str | None = None


class ArtifactUpdate(BaseModel):
    content: str
    note: str | None = None
    author: str | None = None


class TaskIn(BaseModel):
    code: str | None = None
    title: str
    stage: str | None = None
    assignee: str | None = None
    estimate: float | None = None


class TaskTransition(BaseModel):
    to: Literal["todo", "in_progress", "blocked", "done", "cancelled"]


class DecisionIn(BaseModel):
    reason: str | None = None
    edited_diff: dict | None = None


class MaterialIn(BaseModel):
    """资料解析入参：source 可为本地路径、URL，或直接粘贴的文本；file_id 为已上传文件。"""

    source: str = ""
    title: str | None = None
    isText: bool = False
    file_id: str | None = None  # T-BE-01：已上传文件 ID


class DelegateIn(BaseModel):
    sessionId: str
    target: str
    payload: dict
    hitlMode: Hitl = "Semi"

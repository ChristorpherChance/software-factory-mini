"""全部 ORM 实体（与 S2 数据库设计 + M-SET 设置域同源，统一可移植类型）。

设计决策（本地可运行版的契约统一）：
- 设置域采用 M-SET 完整模型（scope/project_id/category/key/value/is_secret 等），
  取代 M1 最小 settings 表，避免两份 settings 定义冲突。
- ``artifact`` 增加 ``status``（draft|finalized），供 M3 定稿使用。
- 新增 ``stage_gate`` 表，承载阶段门/定稿审计（M3 finalize 写入）。
- 不在 SQLite 上施加 CHECK 约束，以容纳委派的 target_type='delegate'/op='invoke' 等。
"""
from datetime import datetime

from sqlalchemy import String, Integer, Numeric, Boolean, Text, JSON, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, PK, FK, created, updated, new_uuid


# ---------------------------------------------------------------------------
# 核心域（S2 数据库设计）
# ---------------------------------------------------------------------------
class Project(Base):
    __tablename__ = "project"
    id: Mapped[str] = PK()
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    current_stage: Mapped[str] = mapped_column(String, default="S0")
    hitl_mode: Mapped[str] = mapped_column(String, default="Semi")
    version: Mapped[int] = mapped_column(Integer, default=1)
    archived_at: Mapped[datetime | None]
    created_at = created()
    updated_at = updated()


class Session(Base):
    __tablename__ = "session"
    id: Mapped[str] = PK()
    project_id: Mapped[str] = FK("project.id")
    parent_session_id: Mapped[str | None] = FK("session.id", ondelete="SET NULL", nullable=True)
    title: Mapped[str | None]
    stage: Mapped[str | None]
    agent: Mapped[str | None]
    hitl_mode: Mapped[str | None]
    delegate_ref: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String, default="active")
    archived_at: Mapped[datetime | None]
    created_at = created()
    updated_at = updated()


class Message(Base):
    __tablename__ = "message"
    id: Mapped[str] = PK()
    session_id: Mapped[str] = FK("session.id")
    role: Mapped[str]
    content: Mapped[str | None] = mapped_column(Text)
    attachments: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="completed")
    created_at = created()


class Artifact(Base):
    __tablename__ = "artifact"
    id: Mapped[str] = PK()
    project_id: Mapped[str] = FK("project.id")
    type: Mapped[str]
    title: Mapped[str]
    stage: Mapped[str | None]
    status: Mapped[str] = mapped_column(String, default="draft")  # draft|finalized
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    version: Mapped[int] = mapped_column(Integer, default=1)
    # 扩展字段：存储参考资料关联（references: string[]）等
    extra: Mapped[dict | None] = mapped_column(JSON, default=None, nullable=True)
    archived_at: Mapped[datetime | None]
    created_at = created()
    updated_at = updated()


class UploadedFile(Base):
    """临时上传文件（T-BE-01）：存于 BLOB_DIR/tmp/{pid}/，7 天后自动清理。"""

    __tablename__ = "uploaded_file"
    id: Mapped[str] = PK()
    project_id: Mapped[str] = FK("project.id")
    name: Mapped[str]                                          # 原始文件名
    path: Mapped[str] = mapped_column(Text)                   # 服务器本地绝对路径
    size: Mapped[int] = mapped_column(Integer, default=0)
    mime_type: Mapped[str] = mapped_column(String, default="application/octet-stream")
    # uploaded → parsing → parsed → finalized
    status: Mapped[str] = mapped_column(String, default="uploaded")
    parsed_artifact_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at = created()


class ArtifactVersion(Base):
    __tablename__ = "artifact_version"
    __table_args__ = (UniqueConstraint("artifact_id", "version", name="uq_artifact_version"),)
    id: Mapped[str] = PK()
    artifact_id: Mapped[str] = FK("artifact.id")
    version: Mapped[int]
    content: Mapped[str | None] = mapped_column(Text)
    author: Mapped[str]
    note: Mapped[str | None]
    created_at = created()


class Task(Base):
    __tablename__ = "task"
    id: Mapped[str] = PK()
    project_id: Mapped[str] = FK("project.id")
    code: Mapped[str | None]
    title: Mapped[str]
    stage: Mapped[str | None]
    status: Mapped[str] = mapped_column(String, default="todo")
    assignee: Mapped[str | None]
    estimate: Mapped[float | None] = mapped_column(Numeric)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at = created()
    updated_at = updated()


class PendingChange(Base):
    __tablename__ = "pending_change"
    id: Mapped[str] = PK()
    project_id: Mapped[str] = FK("project.id")
    target_type: Mapped[str]  # artifact|task|rtm|setting|delegate
    target_id: Mapped[str | None] = mapped_column(String(36))
    op: Mapped[str]  # create|update|delete|invoke
    diff: Mapped[dict] = mapped_column(JSON)
    # Diff 逐块确认（M4 P1-A）：[{id, kind:add|del|mod, tag, lines:[], state:pending|confirmed|rejected}]
    # 编排创建 pending 时计算填入；按块 resolve 端点更新该列；
    # 已有库未含此列时 SQLite create_all 不会自动 ALTER，需删 .db 重建或走幂等 ALTER。
    diff_blocks: Mapped[list | None] = mapped_column(JSON, default=None, nullable=True)
    source_actor: Mapped[str]
    hitl_mode: Mapped[str]
    status: Mapped[str] = mapped_column(String, default="pending")
    created_at = created()


class HitlDecision(Base):
    __tablename__ = "hitl_decision"
    id: Mapped[str] = PK()
    pending_change_id: Mapped[str] = FK("pending_change.id")
    decision: Mapped[str]  # approve|reject|edit_approve
    decided_by: Mapped[str]
    reason: Mapped[str | None]
    edited_diff: Mapped[dict | None] = mapped_column(JSON)
    created_at = created()


class RtmNode(Base):
    __tablename__ = "rtm_node"
    __table_args__ = (UniqueConstraint("project_id", "code", name="uq_rtm_node_code"),)
    id: Mapped[str] = PK()
    project_id: Mapped[str] = FK("project.id")
    code: Mapped[str]
    layer: Mapped[str]  # ORD|CRD|PRD|DSG|TASK|CODE|TEST
    title: Mapped[str | None]
    status: Mapped[str | None]
    created_at = created()


class RtmEdge(Base):
    __tablename__ = "rtm_edge"
    __table_args__ = (
        UniqueConstraint("from_node_id", "to_node_id", "relation", name="uq_rtm_edge"),
    )
    id: Mapped[str] = PK()
    project_id: Mapped[str] = FK("project.id")
    # 约定：from = 下游/子节点（更具体），to = 上游/父节点（其来源），relation='derives'
    from_node_id: Mapped[str] = FK("rtm_node.id")
    to_node_id: Mapped[str] = FK("rtm_node.id")
    relation: Mapped[str] = mapped_column(String, default="derives")
    created_at = created()


class DelegateAudit(Base):
    __tablename__ = "delegate_audit"
    id: Mapped[str] = PK()
    project_id: Mapped[str] = FK("project.id")
    session_id: Mapped[str | None] = FK("session.id", ondelete="SET NULL", nullable=True)
    target: Mapped[str]  # pi_subsession|claude_code|generic_http_agent
    request: Mapped[dict] = mapped_column(JSON)
    response: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String, default="pending")
    latency_ms: Mapped[int | None]
    created_at = created()


class StageGate(Base):
    """阶段门 / 定稿决策记录（M3 finalize 写入）。"""

    __tablename__ = "stage_gate"
    id: Mapped[str] = PK()
    project_id: Mapped[str] = FK("project.id")
    stage: Mapped[str]
    decision: Mapped[str]  # passed|blocked|finalized
    actor: Mapped[str]
    forced: Mapped[bool] = mapped_column(Boolean, default=False)
    report: Mapped[dict | None] = mapped_column(JSON)
    created_at = created()


# ---------------------------------------------------------------------------
# 通知中心（M4 P2 5.1）
# ---------------------------------------------------------------------------
class Notification(Base):
    """通知（task / stage / artifact / crosscut / system 五分组）。"""

    __tablename__ = "notification"
    __table_args__ = (Index("idx_notification_proj", "project_id", "read", "created_at"),)
    id: Mapped[str] = PK()
    project_id: Mapped[str] = FK("project.id")
    group: Mapped[str]  # task | stage | artifact | crosscut | system
    severity: Mapped[str] = mapped_column(String, default="info")  # info|success|warning|error
    title: Mapped[str]
    summary: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None]
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at = created()


# ---------------------------------------------------------------------------
# 设置域（M-SET 完整 6 类 + 端点 + 会话覆盖 + 审计）
# ---------------------------------------------------------------------------
class Setting(Base):
    __tablename__ = "settings"
    __table_args__ = (
        UniqueConstraint("scope", "project_id", "category", "key", name="uq_setting"),
        Index("idx_settings_lookup", "scope", "project_id", "category"),
    )
    id: Mapped[str] = PK()
    scope: Mapped[str] = mapped_column(String, default="global")  # global|project
    project_id: Mapped[str | None] = FK("project.id", nullable=True)
    category: Mapped[str]  # model|hitl|kb|sandbox|endpoint|general
    key: Mapped[str]
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at = updated()


class Endpoint(Base):
    __tablename__ = "endpoints"
    __table_args__ = (Index("idx_endpoints_proj", "project_id", "kind"),)
    id: Mapped[str] = PK()
    project_id: Mapped[str | None] = FK("project.id", nullable=True)
    kind: Mapped[str]  # llm|delegate|kb
    name: Mapped[str]
    base_url: Mapped[str | None]
    model: Mapped[str | None]
    api_key_cipher: Mapped[str | None] = mapped_column(Text)  # AES-256-GCM base64
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at = created()


class SessionSettingOverride(Base):
    __tablename__ = "session_setting_override"
    __table_args__ = (
        UniqueConstraint("session_id", "category", "key", name="uq_session_override"),
    )
    id: Mapped[str] = PK()
    session_id: Mapped[str] = FK("session.id")
    category: Mapped[str]
    key: Mapped[str]
    value: Mapped[dict] = mapped_column(JSON)
    created_at = created()


class SettingAudit(Base):
    __tablename__ = "setting_audit"
    __table_args__ = (Index("idx_setting_audit_proj", "project_id", "created_at"),)
    id: Mapped[str] = PK()
    scope: Mapped[str | None]
    project_id: Mapped[str | None] = mapped_column(String(36))
    session_id: Mapped[str | None] = mapped_column(String(36))
    category: Mapped[str | None]
    key: Mapped[str | None]
    old_value: Mapped[dict | None] = mapped_column(JSON)
    new_value: Mapped[dict | None] = mapped_column(JSON)
    actor: Mapped[str]
    created_at = created()

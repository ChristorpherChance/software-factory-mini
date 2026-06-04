"""ORM 基类与可移植列工具。

为兼容 SQLite 与 Postgres：
- 主键/外键统一用 String(36) 存 UUID 字符串（路径参数天然是 str，避免 UUID 强转坑）。
- JSON 列用通用 ``JSON``（PG→jsonb / SQLite→TEXT）。
- 时间戳用 ``DateTime(timezone=True)`` + ``func.now()``。
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def new_uuid() -> str:
    return str(uuid.uuid4())


def PK() -> Mapped[str]:
    return mapped_column(String(36), primary_key=True, default=new_uuid)


def FK(target: str, ondelete: str = "CASCADE", nullable: bool = False) -> Mapped[str]:
    from sqlalchemy import ForeignKey

    return mapped_column(String(36), ForeignKey(target, ondelete=ondelete), nullable=nullable)


def created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def updated() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class TimestampMixin:
    """提供 created_at / updated_at（M-SET 设置模型用）。"""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

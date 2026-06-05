"""建表 / 初始化（无 alembic 时直接 create_all；幂等）。

SQLite create_all 不会为已存在的表自动加列，因此对增量列做幂等 ALTER TABLE 兜底
（捕获 OperationalError）。生产环境应该走 alembic，本地 mock 数据可接受。
"""
import logging

from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from .db import engine
from .models import Base

log = logging.getLogger(__name__)


# (table, column, ddl) —— 新增字段在这里登记，启动时幂等 ALTER。
_INCREMENTAL_COLUMNS: list[tuple[str, str, str]] = [
    # M4 P1-A：PendingChange.diff_blocks，存切块 diff 列表
    ("pending_change", "diff_blocks", "ALTER TABLE pending_change ADD COLUMN diff_blocks JSON"),
    # 20260603 变更：Artifact.extra，存参考资料关联等扩展字段
    ("artifact", "extra", "ALTER TABLE artifact ADD COLUMN extra JSON"),
]


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for table, column, ddl in _INCREMENTAL_COLUMNS:
            try:
                await conn.execute(text(ddl))
                log.info("init_db: added column %s.%s", table, column)
            except OperationalError as e:
                # SQLite 报 "duplicate column name"；Postgres 报 "already exists"
                msg = str(e).lower()
                if "duplicate column" in msg or "already exists" in msg:
                    continue
                # 表本身缺失（首次启动 create_all 同事务里已经建好，理论不会到这）
                if "no such table" in msg:
                    continue
                raise

    # 各阶段 Agent Prompt 系统默认种子（幂等；新表 create_all 已建好）
    from .db import SessionLocal
    from .services.prompt_seed import seed_prompts

    async with SessionLocal() as s:
        await seed_prompts(s)

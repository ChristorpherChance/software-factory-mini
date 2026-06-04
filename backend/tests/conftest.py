"""pytest 全局夹具：用文件 SQLite + NullPool，保证后台编排任务与请求处理可并发。

每个测试前重建全部表（drop+create），互不污染。
"""
import os
import pathlib

# 必须在导入 app 之前设置环境
_DB = pathlib.Path(__file__).parent / "_pytest.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB.as_posix()}"
os.environ["DB_NULL_POOL"] = "true"
os.environ["EVENT_BACKEND"] = "memory"

import pytest_asyncio  # noqa: E402


@pytest_asyncio.fixture(autouse=True)
async def _reset_db():
    from app.db import engine
    from app.models import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield

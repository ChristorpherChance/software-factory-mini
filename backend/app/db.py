"""异步 SQLAlchemy engine / session（SQLite 与 Postgres 均可）。"""
from sqlalchemy import event
from sqlalchemy.pool import StaticPool, NullPool
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from .config import settings

_is_sqlite = settings.database_url.startswith("sqlite")
_is_memory = _is_sqlite and (":memory:" in settings.database_url)

# SQLite 需放宽线程检查；Postgres 用 pool_pre_ping。
_connect_args = {"check_same_thread": False} if _is_sqlite else {}
_engine_kwargs: dict = {"connect_args": _connect_args, "future": True}
if _is_memory:
    # 内存库：用 StaticPool 共享单连接，否则各连接互为独立内存库（后台任务看不到表）。
    _engine_kwargs["poolclass"] = StaticPool
elif settings.db_null_pool:
    # 测试：每次新连接、用完即关，避免跨事件循环复用连接报错。
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs["pool_pre_ping"] = not _is_sqlite

engine = create_async_engine(settings.database_url, **_engine_kwargs)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


# SQLite 并发友好：开启 WAL + 外键。
if _is_sqlite:
    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _rec):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()


async def get_db():
    """FastAPI 依赖：每请求一个 session。"""
    async with SessionLocal() as s:
        yield s

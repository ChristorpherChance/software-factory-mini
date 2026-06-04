"""应用装配 + 路由挂载 + 启动建表。"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.v1 import router as api_v1
from .sse import router as sse_router
from .core.errors import install_error_handlers
from .core.observability import metrics_snapshot
from .db_init import init_db

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    # T-BE-01：注册临时文件清理后台任务
    from .api.v1.files import start_cleanup_task
    start_cleanup_task()
    yield


app = FastAPI(title="Software Factory Mini", version="0.1.0", lifespan=lifespan)

# 本地开发：前端 3000 → 后端 8000 直连时放开 CORS（经 Nginx 同源时无影响）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

install_error_handlers(app)
app.include_router(api_v1, prefix="/api/v1")
app.include_router(sse_router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health():
    return {"data": {"ok": True}}


@app.get("/api/v1/metrics")
async def metrics():
    return {"data": metrics_snapshot()}

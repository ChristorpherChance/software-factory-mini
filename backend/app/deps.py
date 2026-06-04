"""鉴权与乐观锁依赖。"""
from fastapi import Header

from .core.errors import AppError
from .config import settings


async def require_auth(authorization: str = Header(default="")) -> dict:
    token = authorization.removeprefix("Bearer ").strip()
    if token != settings.auth_bearer_token:
        raise AppError(401, "missing or invalid token", "UNAUTHORIZED")
    return {"actor": "user:single", "id": "user:single"}


def if_match(if_match: int | None = Header(default=None, alias="If-Match")) -> int | None:
    """返回 If-Match 版本号；冲突校验在各 service 内比对 version。"""
    return if_match

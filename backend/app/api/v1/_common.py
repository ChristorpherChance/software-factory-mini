"""分页 / 包裹 / 乐观锁 / 幂等 工具（对齐 S2 接口设计 §1.3~1.5）。"""
import uuid

from ...core.errors import AppError


def rid() -> str:
    return str(uuid.uuid4())


def ok(data, **meta) -> dict:
    return {"data": data, "meta": {"requestId": rid(), **meta}}


def paged(items, limit: int = 50, next_cursor=None, total=None) -> dict:
    return {
        "data": items,
        "page": {
            "cursor": None,
            "nextCursor": next_cursor,
            "limit": limit,
            "total": total if total is not None else len(items),
        },
        "meta": {"requestId": rid()},
    }


def check_version(current: int, im: int | None) -> None:
    if im is not None and im != current:
        raise AppError(409, "version conflict", "CONFLICT", {"expected": current, "got": im})


# v0.1 进程内幂等缓存（重复 Idempotency-Key 返回首次结果）
_idem: dict[str, dict] = {}


def idem_get(key: str | None):
    return _idem.get(key) if key else None


def idem_put(key: str | None, val: dict) -> dict:
    if key:
        _idem[key] = val
    return val

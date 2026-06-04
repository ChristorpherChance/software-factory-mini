"""统一错误码与异常处理（对齐 S2 接口设计 §12）。"""
import uuid

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

CODE_BY_STATUS = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "RESOURCE_NOT_FOUND",
    409: "CONFLICT",
    422: "GATE_BLOCKED",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
    502: "DELEGATE_UPSTREAM_ERROR",
}


class AppError(Exception):
    def __init__(
        self,
        status: int,
        message: str = "",
        code: str | None = None,
        details: dict | None = None,
    ):
        self.status = status
        self.code = code or CODE_BY_STATUS.get(status, "INTERNAL_ERROR")
        self.message = message or self.code
        self.details = details or {}
        super().__init__(self.message)


def _body(code: str, message: str, details: dict) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "requestId": str(uuid.uuid4()),
        }
    }


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app(_request, e: AppError):  # noqa: ANN001
        return JSONResponse(status_code=e.status, content=_body(e.code, e.message, e.details))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_request, e: StarletteHTTPException):  # noqa: ANN001
        code = CODE_BY_STATUS.get(e.status_code, "INTERNAL_ERROR")
        return JSONResponse(status_code=e.status_code, content=_body(code, str(e.detail), {}))

    @app.exception_handler(RequestValidationError)
    async def _val(_request, e: RequestValidationError):  # noqa: ANN001
        return JSONResponse(
            status_code=400,
            content=_body("VALIDATION_ERROR", "validation failed", {"errors": e.errors()}),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_request, e: Exception):  # noqa: ANN001
        return JSONResponse(status_code=500, content=_body("INTERNAL_ERROR", str(e), {}))

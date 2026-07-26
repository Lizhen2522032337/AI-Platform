"""统一 API 错误及异常处理器。"""

import logging

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError


logger = logging.getLogger(__name__)


class APIError(Exception):
    """业务错误，转换为统一 JSON 结构。"""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message


def error_body(code: str, message: str) -> dict[str, dict[str, str]]:
    """构造统一错误响应。"""

    return {"error": {"code": code, "message": message}}


async def api_error_handler(_: Request, exc: APIError) -> JSONResponse:
    """处理显式业务错误。"""

    return JSONResponse(
        status_code=exc.status_code,
        content=error_body(exc.code, exc.message),
    )

async def validation_error_handler(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    """将 FastAPI 默认的 422 转换为契约要求的 400。"""

    first_error = exc.errors()[0] if exc.errors() else None
    message = first_error.get("msg", "invalid request") if first_error else "invalid request"
    return JSONResponse(
        status_code=400,
        content=error_body("VALIDATION_ERROR", message),
    )


async def database_error_handler(_: Request, exc: SQLAlchemyError) -> JSONResponse:
    """记录数据库错误，但不向客户端泄露连接信息。"""

    logger.exception("database operation failed", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content=error_body("DATABASE_ERROR", "database operation failed"),
    )

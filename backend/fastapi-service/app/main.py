"""FastAPI 服务入口。"""

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.errors import (
    APIError,
    api_error_handler,
    database_error_handler,
    validation_error_handler,
)
from app.routers.items import router as items_router


# 创建 FastAPI 应用实例，供 Uvicorn 加载。
app = FastAPI()
app.add_exception_handler(APIError, api_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(SQLAlchemyError, database_error_handler)
app.include_router(items_router)


@app.get("/")
def root():
    """返回服务运行状态。"""
    return {
        "message": "FastAPI running"
    }

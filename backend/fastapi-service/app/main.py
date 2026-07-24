"""FastAPI 服务入口。"""

from fastapi import FastAPI


# 创建 FastAPI 应用实例，供 Uvicorn 加载。
app = FastAPI()


@app.get("/")
def root():
    """返回服务运行状态。"""
    return {
        "message": "FastAPI running"
    }

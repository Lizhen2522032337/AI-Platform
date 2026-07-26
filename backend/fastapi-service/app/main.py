"""FastAPI AI 服务入口。"""

from fastapi import FastAPI
from pydantic import BaseModel, Field

from app.integrations import check_integrations, process_prompt


class ProcessRequest(BaseModel):
    """Worker 调用 AI 服务时提交的任务。"""

    task_id: int = Field(alias="taskId", gt=0)
    prompt: str = Field(min_length=1, max_length=4000)


class ProcessResponse(BaseModel):
    """AI 服务返回给 Worker 的处理结果。"""

    task_id: int = Field(alias="taskId")
    text: str
    vector_id: str = Field(alias="vectorId")
    object_key: str = Field(alias="objectKey")


app = FastAPI(title="Enterprise AI Service", version="1.0.0")


@app.get("/")
def root() -> dict[str, str]:
    """返回服务角色。"""

    return {"service": "fastapi-service", "role": "ai-service", "status": "running"}


@app.get("/health")
def health() -> dict[str, object]:
    """检查 AI 服务以及 Qdrant、MinIO。"""

    check_integrations()
    return {
        "status": "ok",
        "service": "fastapi-service",
        "dependencies": {"qdrant": "ok", "minio": "ok"},
    }


@app.post("/process", response_model=ProcessResponse)
def process(payload: ProcessRequest) -> dict[str, object]:
    """供 Worker 内部调用的 AI 处理接口。"""

    return process_prompt(payload.task_id, payload.prompt)

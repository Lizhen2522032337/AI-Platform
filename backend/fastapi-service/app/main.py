"""FastAPI AI 服务入口。"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from app.integrations import check_integrations, save_result
from app.llm import ChatMessage, LlmProviderError, ModelProvider, stream_chat


logger = logging.getLogger(__name__)


class ConversationMessage(BaseModel):
    """Worker 从 PostgreSQL 组装的单条历史消息。"""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20000)


class ProcessRequest(BaseModel):
    """Worker 调用 AI 服务时提交的任务。"""

    task_id: int = Field(alias="taskId", gt=0)
    prompt: str = Field(min_length=1, max_length=4000)
    model_provider: ModelProvider = Field(alias="modelProvider")
    messages: list[ConversationMessage] = Field(min_length=1, max_length=41)


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


def ndjson(event: dict[str, object]) -> bytes:
    """把内部流式事件编码为一行 JSON。"""

    return (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")


async def process_events(payload: ProcessRequest) -> AsyncIterator[bytes]:
    """调用大模型并输出增量，完成后保存答案并发送最终结果。"""

    answer_parts: list[str] = []
    usage: dict[str, object] | None = None
    model = ""
    try:
        history: list[ChatMessage] = [
            {"role": message.role, "content": message.content}
            for message in payload.messages
        ]
        async for event in stream_chat(payload.model_provider, history):
            if event["type"] == "start":
                model = str(event["model"])
            elif event["type"] == "delta":
                answer_parts.append(str(event["text"]))
            elif event["type"] == "usage":
                usage = event["usage"]
            yield ndjson(event)

        answer = "".join(answer_parts).strip()
        if not answer:
            raise LlmProviderError("大模型没有返回有效回答")
        result = save_result(
            payload.task_id,
            payload.prompt,
            answer,
            payload.model_provider,
            model,
            usage,
        )
        yield ndjson({"type": "complete", "result": result})
    except LlmProviderError as error:
        logger.warning(
            "LLM request failed: task_id=%s provider=%s error=%s",
            payload.task_id,
            payload.model_provider,
            error,
        )
        yield ndjson({"type": "error", "message": str(error)})
    except Exception:
        # 仅给 Worker 返回稳定错误，不泄露堆栈、Key 或供应商响应。
        logger.exception(
            "AI result persistence failed: task_id=%s provider=%s",
            payload.task_id,
            payload.model_provider,
        )
        yield ndjson({"type": "error", "message": "AI 服务处理失败"})


@app.post("/process")
def process(payload: ProcessRequest) -> StreamingResponse:
    """供 Worker 内部调用的 NDJSON 流式 AI 接口。"""

    return StreamingResponse(process_events(payload), media_type="application/x-ndjson")

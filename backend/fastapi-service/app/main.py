"""FastAPI AI 服务入口。"""

import json
import logging
import os
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import FastAPI, Response, status
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from app.dify import DifyKnowledgeError, retrieve_knowledge
from app.integrations import check_integrations, delete_results, save_result
from app.llm import ChatMessage, LlmProviderError, ModelProvider, stream_chat


# 统一 FastAPI 及其子模块日志级别；生产日志不包含提示词、知识正文或密钥。
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
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


class ArtifactTask(BaseModel):
    """NestJS 从数据库读取的单个任务产物定位信息。"""

    task_id: int = Field(alias="taskId", gt=0)
    object_key: str | None = Field(
        default=None,
        alias="objectKey",
        max_length=500,
        pattern=r"^tasks/[1-9][0-9]*/result\.json$",
    )


class DeleteArtifactsRequest(BaseModel):
    """一次会话删除请求中需要清理的全部任务。"""

    tasks: list[ArtifactTask] = Field(max_length=100)


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
    """先检索 Dify，再调用大模型；完成后持久化答案并发送最终事件。"""

    answer_parts: list[str] = []
    usage: dict[str, object] | None = None
    model = ""
    logger.info(
        "AI task accepted: task_id=%s provider=%s history_messages=%d prompt_chars=%d",
        payload.task_id,
        payload.model_provider,
        len(payload.messages),
        len(payload.prompt),
    )
    try:
        # 只使用当前问题检索知识库；历史消息仍完整交给大模型维持多轮语义。
        knowledge = await retrieve_knowledge(payload.prompt)
        logger.info(
            "AI task knowledge ready: task_id=%s enabled=%s hits=%d",
            payload.task_id,
            knowledge.enabled,
            knowledge.hit_count,
        )
        history: list[ChatMessage] = [
            {"role": message.role, "content": message.content}
            for message in payload.messages
        ]
        # “没有命中”也明确告诉模型，避免用户误以为回答一定来自企业知识库。
        knowledge_context = knowledge.context
        if knowledge.enabled and not knowledge_context:
            knowledge_context = "[知识库检索结果]\n本次问题未检索到相关知识块。"
        async for event in stream_chat(
            payload.model_provider,
            history,
            knowledge_context,
        ):
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
        logger.info(
            "AI task completed: task_id=%s provider=%s model=%s answer_chars=%d",
            payload.task_id,
            payload.model_provider,
            model,
            len(answer),
        )
        yield ndjson({"type": "complete", "result": result})
    except (DifyKnowledgeError, LlmProviderError) as error:
        logger.warning(
            "AI dependency request failed: task_id=%s provider=%s error=%s",
            payload.task_id,
            payload.model_provider,
            error,
        )
        yield ndjson({"type": "error", "message": str(error)})
    except Exception:
        # 仅给 Worker 返回稳定错误，不泄露堆栈、Key 或供应商响应。
        logger.exception(
            "AI task processing failed: task_id=%s provider=%s",
            payload.task_id,
            payload.model_provider,
        )
        yield ndjson({"type": "error", "message": "AI 服务处理失败"})


@app.post("/process")
def process(payload: ProcessRequest) -> StreamingResponse:
    """供 Worker 内部调用的 NDJSON 流式 AI 接口。"""

    return StreamingResponse(process_events(payload), media_type="application/x-ndjson")


@app.delete("/artifacts/tasks", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_artifacts(payload: DeleteArtifactsRequest) -> Response:
    """供 NestJS 内部调用，删除会话任务的向量和结果文件。"""

    delete_results(
        [(task.task_id, task.object_key) for task in payload.tasks],
    )
    logger.info("AI task artifacts deleted: tasks=%d", len(payload.tasks))
    return Response(status_code=status.HTTP_204_NO_CONTENT)

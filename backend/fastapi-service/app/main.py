"""FastAPI AI 服务入口。"""

import asyncio
import json
import logging
import os
import time
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import FastAPI, Response, status
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from app.agent import AgentPreparation, prepare_agent
from app.agent.notification_tool import NotificationToolError, send_notification
from app.agent.platform_data_renderer import render_platform_data_answer
from app.agent.report_tools import create_report_files
from app.agent.types import DatabaseType
from app.config.settings import get_settings
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
    database_type: DatabaseType = Field(default="postgresql", alias="databaseType")
    # 该权限只能由 NestJS 根据服务端 RBAC 写入 RabbitMQ，前端不能直接调用本接口。
    allow_dynamic_sql: bool = Field(default=False, alias="allowDynamicSql")
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


def merge_trace_step(
    trace: list[dict[str, object]], step: dict[str, object]
) -> None:
    """按稳定步骤 ID 更新轨迹，避免 running/completed 在前台重复出现。"""

    step_id = str(step.get("id") or "")
    if not step_id:
        return
    for index, current in enumerate(trace):
        if current.get("id") == step_id:
            trace[index] = {**current, **step}
            return
    trace.append(dict(step))


async def process_events(payload: ProcessRequest) -> AsyncIterator[bytes]:
    """运行 LangGraph Agent，再流式生成回答并持久化报告产物。"""

    answer_parts: list[str] = []
    usage: dict[str, object] | None = None
    model = ""
    preparation: AgentPreparation | None = None
    execution_trace: list[dict[str, object]] = []
    logger.info(
        "AI task accepted: task_id=%s provider=%s database=%s history_messages=%d prompt_chars=%d",
        payload.task_id,
        payload.model_provider,
        payload.database_type,
        len(payload.messages),
        len(payload.prompt),
    )
    try:
        history: list[ChatMessage] = [
            {"role": message.role, "content": message.content}
            for message in payload.messages
        ]
        settings = get_settings()
        if settings.agent_enabled:
            # Agent 图通过队列上报安全摘要；图本身仍在同一请求内按原有顺序执行。
            trace_queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
            agent_task = asyncio.create_task(
                prepare_agent(
                    payload.task_id,
                    payload.prompt,
                    payload.model_provider,
                    history,
                    payload.database_type,
                    allow_dynamic_sql=payload.allow_dynamic_sql,
                    trace_callback=trace_queue.put_nowait,
                )
            )
            while not agent_task.done() or not trace_queue.empty():
                try:
                    step = await asyncio.wait_for(trace_queue.get(), timeout=0.1)
                except TimeoutError:
                    continue
                merge_trace_step(execution_trace, step)
                yield ndjson({"type": "trace", "step": step})
            preparation = await agent_task
            evidence_context = preparation.context
            logger.info(
                "Agent evidence ready: task_id=%s intent=%s queries=%d",
                payload.task_id,
                preparation.intent,
                len(preparation.plan.queries),
            )
        else:
            # 保留紧急回退开关：关闭 Agent 时仍使用原来的 Dify → LLM 流程。
            retrieval_started = time.perf_counter()
            retrieval_step: dict[str, object] = {
                "id": "dify_knowledge",
                "title": "检索企业知识库",
                "status": "running",
                "kind": "tool",
                "toolName": "dify_knowledge",
            }
            merge_trace_step(execution_trace, retrieval_step)
            yield ndjson({"type": "trace", "step": retrieval_step})
            knowledge = await retrieve_knowledge(payload.prompt)
            evidence_context = knowledge.context
            if knowledge.enabled and not evidence_context:
                evidence_context = "[知识库检索结果]\n本次问题未检索到相关知识块。"
            retrieval_step = {
                **retrieval_step,
                "status": "completed" if knowledge.enabled else "skipped",
                "detail": (
                    f"已取得 {knowledge.hit_count} 个相关知识块"
                    if knowledge.enabled
                    else "Dify Knowledge 当前未启用"
                ),
                "durationMs": round((time.perf_counter() - retrieval_started) * 1000),
            }
            merge_trace_step(execution_trace, retrieval_step)
            yield ndjson({"type": "trace", "step": retrieval_step})

        platform_data_result = bool(
            preparation is not None
            and preparation.intent == "platform_data_query"
        )
        generation_started = time.perf_counter()
        generation_step: dict[str, object] = {
            "id": "model_generation",
            "title": "生成最终回答",
            "status": "running",
            "kind": "tool",
            "toolName": (
                "platform_data_renderer" if platform_data_result else payload.model_provider
            ),
            "detail": (
                "正在把已校验的平台数据渲染为表格"
                if platform_data_result
                else f"正在调用 {payload.model_provider}"
            ),
        }
        merge_trace_step(execution_trace, generation_step)
        yield ndjson({"type": "trace", "step": generation_step})
        if platform_data_result and preparation is not None:
            model = "platform-data-renderer"
            rendered_answer = render_platform_data_answer(preparation.observations)
            answer_parts.append(rendered_answer)
            yield ndjson(
                {
                    "type": "start",
                    "provider": payload.model_provider,
                    "model": model,
                }
            )
            yield ndjson({"type": "delta", "text": rendered_answer})
        else:
            async for event in stream_chat(
                payload.model_provider,
                history,
                evidence_context,
            ):
                if event["type"] == "start":
                    model = str(event["model"])
                    generation_step = {
                        **generation_step,
                        "detail": f"模型：{model}",
                    }
                    merge_trace_step(execution_trace, generation_step)
                    yield ndjson({"type": "trace", "step": generation_step})
                elif event["type"] == "delta":
                    answer_parts.append(str(event["text"]))
                elif event["type"] == "usage":
                    usage = event["usage"]
                yield ndjson(event)

        answer = "".join(answer_parts).strip()
        if not answer:
            raise LlmProviderError("大模型没有返回有效回答")
        generation_step = {
            **generation_step,
            "status": "completed",
            "detail": (
                f"结构化渲染器生成 {len(answer)} 个字符"
                if platform_data_result
                else f"模型：{model or payload.model_provider}，生成 {len(answer)} 个字符"
            ),
            "durationMs": round((time.perf_counter() - generation_started) * 1000),
        }
        merge_trace_step(execution_trace, generation_step)
        yield ndjson({"type": "trace", "step": generation_step})
        artifacts: list[dict[str, object]] = []
        if preparation is not None and preparation.plan.report_required:
            report_started = time.perf_counter()
            report_step: dict[str, object] = {
                "id": "report_files",
                "title": "生成报告文件",
                "status": "running",
                "kind": "tool",
                "toolName": "report_files",
            }
            merge_trace_step(execution_trace, report_step)
            yield ndjson({"type": "trace", "step": report_step})
            artifacts = create_report_files(
                payload.task_id,
                preparation.plan.report_title,
                answer,
                preparation.observations,
            )
            report_step = {
                **report_step,
                "status": "completed",
                "detail": f"已生成 {len(artifacts)} 个报告文件",
                "durationMs": round((time.perf_counter() - report_started) * 1000),
            }
            merge_trace_step(execution_trace, report_step)
            yield ndjson({"type": "trace", "step": report_step})
        notification_sent = False
        if preparation is not None and preparation.plan.notify:
            notification_started = time.perf_counter()
            notification_step: dict[str, object] = {
                "id": "notification",
                "title": "发送分析通知",
                "status": "running",
                "kind": "tool",
                "toolName": "notification",
            }
            merge_trace_step(execution_trace, notification_step)
            yield ndjson({"type": "trace", "step": notification_step})
            try:
                notification_sent = await send_notification(
                    payload.task_id,
                    preparation.plan.report_title,
                    answer,
                    artifacts,
                )
                notification_step = {
                    **notification_step,
                    "status": "completed" if notification_sent else "skipped",
                    "detail": "通知已发送" if notification_sent else "通知策略未允许自动发送",
                    "durationMs": round(
                        (time.perf_counter() - notification_started) * 1000
                    ),
                }
            except NotificationToolError as error:
                # 通知不是分析结果的事务边界；失败会记录，但不丢弃已经完成的报告。
                logger.warning(
                    "Agent notification skipped after failure: task_id=%s error=%s",
                    payload.task_id,
                    error,
                )
                notification_step = {
                    **notification_step,
                    "status": "failed",
                    "detail": str(error),
                    "durationMs": round(
                        (time.perf_counter() - notification_started) * 1000
                    ),
                }
            merge_trace_step(execution_trace, notification_step)
            yield ndjson({"type": "trace", "step": notification_step})
        result = save_result(
            payload.task_id,
            payload.prompt,
            answer,
            payload.model_provider,
            model,
            usage,
            artifacts,
            {
                "enabled": preparation is not None,
                "intent": preparation.intent if preparation else "direct_chat",
                "databaseType": payload.database_type,
                "reportRequired": preparation.plan.report_required if preparation else False,
                "notificationSent": notification_sent,
            },
            execution_trace,
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
        failure_step = {
            "id": "execution_error",
            "title": "执行任务",
            "status": "failed",
            "kind": "stage",
            "detail": str(error),
        }
        merge_trace_step(execution_trace, failure_step)
        yield ndjson({"type": "trace", "step": failure_step})
        yield ndjson({"type": "error", "message": str(error)})
    except Exception:
        # 仅给 Worker 返回稳定错误，不泄露堆栈、Key 或供应商响应。
        logger.exception(
            "AI task processing failed: task_id=%s provider=%s",
            payload.task_id,
            payload.model_provider,
        )
        failure_step = {
            "id": "execution_error",
            "title": "执行任务",
            "status": "failed",
            "kind": "stage",
            "detail": "执行过程中发生未预期错误",
        }
        merge_trace_step(execution_trace, failure_step)
        yield ndjson({"type": "trace", "step": failure_step})
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

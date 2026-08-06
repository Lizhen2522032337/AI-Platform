"""从 RabbitMQ 消费任务，调用 FastAPI，并更新 PostgreSQL 与 Redis。"""

import json
import logging
import os
import threading
import time
import urllib.request
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pika
import psycopg
import redis

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)
worker_ready = False


class TaskExecutionError(RuntimeError):
    """携带已完成执行轨迹的任务错误，便于失败后继续审计。"""

    def __init__(self, message: str, execution_trace: list[dict[str, Any]]):
        super().__init__(message)
        self.execution_trace = execution_trace


def merge_trace_step(trace: list[dict[str, Any]], step: dict[str, Any]) -> None:
    """按步骤 ID 合并运行中和最终状态。"""

    step_id = str(step.get("id") or "")
    if not step_id:
        return
    for index, current in enumerate(trace):
        if current.get("id") == step_id:
            trace[index] = {**current, **step}
            return
    trace.append(dict(step))


def required(name: str) -> str:
    """读取必填环境变量。"""

    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def postgres_connection() -> psycopg.Connection:
    """创建短生命周期 PostgreSQL 连接。"""

    return psycopg.connect(
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        dbname=os.getenv("POSTGRES_DB", "enterprise_ai_platform"),
        user=os.getenv("POSTGRES_USER", "enterprise_ai"),
        password=required("POSTGRES_PASSWORD"),
        sslmode=os.getenv("POSTGRES_SSLMODE", "disable"),
        connect_timeout=5,
    )


redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST", "redis"),
    port=int(os.getenv("REDIS_PORT", "6379")),
    password=os.getenv("REDIS_PASSWORD"),
    decode_responses=True,
)


def save_state(task_id: int, state: dict[str, Any]) -> None:
    """把最新任务状态写入 Redis，供 Gin 实时接口读取。

    此函数处于流式热路径，不逐次打印日志，否则每个回答会产生大量重复输出。
    """

    redis_client.setex(
        f"task:{task_id}",
        86400,
        json.dumps(state, ensure_ascii=False),
    )


def update_task(
    task_id: int,
    status: str,
    *,
    result: dict[str, Any] | None = None,
    error_message: str | None = None,
    answer: str | None = None,
    model_name: str | None = None,
) -> None:
    """更新 PostgreSQL 最终事实记录；Redis 只保存可过期的实时快照。"""

    with postgres_connection() as connection:
        connection.execute(
            """
            UPDATE ai_tasks
            SET status = %s,
                result = %s::jsonb,
                error_message = %s,
                object_key = %s,
                vector_id = %s,
                answer = COALESCE(%s, answer),
                model_name = COALESCE(%s, model_name),
                updated_at = NOW()
            WHERE id = %s
            """,
            (
                status,
                json.dumps(result, ensure_ascii=False) if result else None,
                error_message,
                result.get("objectKey") if result else None,
                result.get("vectorId") if result else None,
                answer,
                model_name,
                task_id,
            ),
        )
    logger.info("task database state updated: task_id=%s status=%s", task_id, status)


def load_conversation_messages(
    conversation_id: int | None,
    current_task_id: int,
    current_prompt: str,
) -> list[dict[str, str]]:
    """读取最近若干轮完整历史，并追加当前问题；供应商 API 本身不保存上下文。"""

    if conversation_id is None:
        logger.info(
            "conversation context prepared: task_id=%s conversation_id=none history_turns=0",
            current_task_id,
        )
        return [{"role": "user", "content": current_prompt}]
    try:
        context_turns = int(os.getenv("AI_CONTEXT_TURNS", "10"))
    except ValueError:
        context_turns = 10
    context_turns = max(1, min(context_turns, 20))
    with postgres_connection() as connection:
        rows = connection.execute(
            """
            SELECT prompt, answer
            FROM (
                SELECT id, prompt, answer
                FROM ai_tasks
                WHERE conversation_id = %s
                  AND id < %s
                  AND status = 'completed'
                  AND answer IS NOT NULL
                ORDER BY id DESC
                LIMIT %s
            ) history
            ORDER BY id
            """,
            (conversation_id, current_task_id, context_turns),
        ).fetchall()
    messages: list[dict[str, str]] = []
    for prompt, answer in rows:
        messages.append({"role": "user", "content": str(prompt)})
        messages.append({"role": "assistant", "content": str(answer)})
    messages.append({"role": "user", "content": current_prompt})
    logger.info(
        "conversation context prepared: task_id=%s conversation_id=%s history_turns=%s",
        current_task_id,
        conversation_id,
        len(rows),
    )
    return messages


def stream_ai_service(
    task_id: int,
    prompt: str,
    model_provider: str,
    database_type: str,
    allow_dynamic_sql: bool,
    allow_admin_knowledge: bool,
    messages: list[dict[str, str]],
) -> Iterator[dict[str, Any]]:
    """逐行读取内部 FastAPI 返回的 NDJSON 大模型事件流。"""

    base_url = os.getenv("AI_SERVICE_URL", "http://fastapi-service:8000")
    body = json.dumps(
        {
            "taskId": task_id,
            "prompt": prompt,
            "modelProvider": model_provider,
            "databaseType": database_type,
            "allowDynamicSql": allow_dynamic_sql,
            "allowAdminKnowledge": allow_admin_knowledge,
            "messages": messages,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/process",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    logger.info(
        "FastAPI stream request started: task_id=%s provider=%s database=%s messages=%s",
        task_id,
        model_provider,
        database_type,
        len(messages),
    )
    with urllib.request.urlopen(request, timeout=360) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8").strip()
            if not line:
                continue
            event = json.loads(line)
            if not isinstance(event, dict) or "type" not in event:
                raise RuntimeError("AI 服务返回了无效事件")
            yield event
    logger.info("FastAPI stream request ended: task_id=%s", task_id)


def process_message(body: bytes) -> None:
    """执行单个队列任务。"""

    message = json.loads(body.decode("utf-8"))
    task_id = int(message["id"])
    # 兼容认证功能上线前已经进入队列的旧消息；0 表示无归属，仅管理员可查看。
    owner_id = int(message.get("ownerId") or 0)
    prompt = str(message["prompt"])
    model_provider = str(message.get("modelProvider") or "deepseek")
    database_type = str(message.get("databaseType") or "postgresql")
    # 只接受 NestJS 写入 RabbitMQ 的 JSON 布尔值；缺省和其他类型均按无权限处理。
    allow_dynamic_sql = message.get("allowDynamicSql") is True
    allow_admin_knowledge = message.get("allowAdminKnowledge") is True
    conversation_id_value = message.get("conversationId")
    conversation_id = (
        int(conversation_id_value) if conversation_id_value is not None else None
    )
    if model_provider not in {"deepseek", "qwen"}:
        raise RuntimeError("不支持的模型供应商")
    if database_type not in {"postgresql", "db2"}:
        raise RuntimeError("不支持的数据库类型")
    logger.info(
        "task message received: task_id=%s owner_id=%s conversation_id=%s provider=%s database=%s prompt_chars=%s",
        task_id,
        owner_id,
        conversation_id,
        model_provider,
        database_type,
        len(prompt),
    )
    execution_trace: list[dict[str, Any]] = [
        {
            "id": "worker_started",
            "title": "任务进入异步执行器",
            "status": "completed",
            "kind": "stage",
            "detail": "Worker 已从 RabbitMQ 接收任务",
        }
    ]
    processing_state = {
        "id": task_id,
        "ownerId": owner_id,
        "status": "processing",
        "modelProvider": model_provider,
        "databaseType": database_type,
        "partialText": "",
        "conversationId": conversation_id,
        "executionTrace": execution_trace,
    }
    update_task(task_id, "processing")
    save_state(task_id, processing_state)

    answer_parts: list[str] = []
    model_name: str | None = None
    result: dict[str, Any] | None = None
    last_publish = 0.0
    context_started = time.monotonic()
    messages = load_conversation_messages(conversation_id, task_id, prompt)
    history_turns = max(0, (len(messages) - 1) // 2)
    merge_trace_step(
        execution_trace,
        {
            "id": "conversation_context",
            "title": "加载会话上下文",
            "status": "completed",
            "kind": "stage",
            "detail": f"已加载最近 {history_turns} 轮历史对话",
            "durationMs": round((time.monotonic() - context_started) * 1000),
        },
    )
    save_state(task_id, processing_state)
    try:
        for event in stream_ai_service(
            task_id,
            prompt,
            model_provider,
            database_type,
            allow_dynamic_sql,
            allow_admin_knowledge,
            messages,
        ):
            event_type = event.get("type")
            if event_type == "trace":
                step = event.get("step")
                if not isinstance(step, dict):
                    raise RuntimeError("AI 服务返回了无效执行轨迹")
                merge_trace_step(execution_trace, step)
                save_state(
                    task_id,
                    {
                        **processing_state,
                        "modelName": model_name,
                        "partialText": "".join(answer_parts),
                        "executionTrace": execution_trace,
                    },
                )
            elif event_type == "start":
                model_name = str(event.get("model") or "") or None
                logger.info(
                    "AI generation started: task_id=%s model=%s",
                    task_id,
                    model_name or "unknown",
                )
            elif event_type == "delta":
                text = str(event.get("text") or "")
                if not text:
                    continue
                answer_parts.append(text)
                now = time.monotonic()
                # 合并高频 token，最多每 100ms 写一次 Redis，兼顾流畅度和中间件压力。
                if now - last_publish >= 0.1:
                    save_state(
                        task_id,
                        {
                            **processing_state,
                            "modelName": model_name,
                            "partialText": "".join(answer_parts),
                            "executionTrace": execution_trace,
                        },
                    )
                    last_publish = now
            elif event_type == "complete":
                candidate = event.get("result")
                if not isinstance(candidate, dict):
                    raise RuntimeError("AI 服务没有返回有效结果")
                result = candidate
                model_name = str(result.get("model") or model_name or "") or None
            elif event_type == "error":
                raise TaskExecutionError(
                    str(event.get("message") or "AI 服务处理失败"),
                    execution_trace,
                )
    except TaskExecutionError:
        raise
    except Exception as error:
        merge_trace_step(
            execution_trace,
            {
                "id": "execution_error",
                "title": "执行任务",
                "status": "failed",
                "kind": "stage",
                "detail": "AI 服务连接或事件处理失败",
            },
        )
        raise TaskExecutionError(str(error), execution_trace) from error

    if result is None:
        raise TaskExecutionError("AI 服务流意外结束", execution_trace)
    answer = str(result.get("text") or "".join(answer_parts)).strip()
    if not answer:
        raise TaskExecutionError("AI 服务没有返回回答", execution_trace)
    # Worker 的上下文阶段也属于完整轨迹，以 Worker 汇总结果覆盖 FastAPI 子集。
    result["executionTrace"] = execution_trace
    update_task(
        task_id,
        "completed",
        result=result,
        answer=answer,
        model_name=model_name,
    )
    save_state(
        task_id,
        {
            "id": task_id,
            "ownerId": owner_id,
            "status": "completed",
            "modelProvider": model_provider,
            "databaseType": database_type,
            "modelName": model_name,
            "conversationId": conversation_id,
            # 终态再次携带完整文本，避免前端停留在最后一次节流写入的 partialText。
            "partialText": answer,
            "result": result,
            "executionTrace": execution_trace,
        },
    )
    logger.info("task completed: %s", task_id)


class HealthHandler(BaseHTTPRequestHandler):
    """为 Docker 提供极简健康检查。"""

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_response(404)
            self.end_headers()
            return
        status = 200 if worker_ready else 503
        payload = json.dumps(
            {"status": "ok" if worker_ready else "starting", "service": "worker"}
        ).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        """避免健康检查刷屏。"""


def start_health_server() -> None:
    """后台启动健康检查 HTTP 服务。"""

    server = ThreadingHTTPServer(("0.0.0.0", 8090), HealthHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()


def consume() -> None:
    """连接 RabbitMQ 并持续消费持久化任务队列。"""

    global worker_ready
    credentials = pika.PlainCredentials(
        os.getenv("RABBITMQ_DEFAULT_USER", "enterprise_ai"),
        required("RABBITMQ_DEFAULT_PASS"),
    )
    parameters = pika.ConnectionParameters(
        host=os.getenv("RABBITMQ_HOST", "rabbitmq"),
        port=int(os.getenv("RABBITMQ_PORT", "5672")),
        virtual_host=os.getenv("RABBITMQ_DEFAULT_VHOST", "enterprise_ai"),
        credentials=credentials,
        heartbeat=30,
        blocked_connection_timeout=30,
    )
    logger.info(
        "connecting to RabbitMQ: host=%s port=%s", parameters.host, parameters.port
    )
    connection = pika.BlockingConnection(parameters)
    channel = connection.channel()
    queue = os.getenv("RABBITMQ_TASK_QUEUE", "ai_tasks")
    channel.queue_declare(
        queue=queue,
        durable=True,
        arguments={"x-queue-type": "quorum"},
    )
    channel.basic_qos(prefetch_count=1)
    # prefetch=1 保证单个 Worker 一次只处理一个任务，避免流式请求挤占内存。

    def callback(
        current_channel: pika.channel.Channel,
        method: pika.spec.Basic.Deliver,
        _: pika.spec.BasicProperties,
        body: bytes,
    ) -> None:
        task_id: int | None = None
        owner_id: int | None = None
        conversation_id: int | None = None
        model_provider: str | None = None
        database_type: str | None = None
        try:
            decoded = json.loads(body.decode("utf-8"))
            task_id = int(decoded["id"])
            owner_id = int(decoded.get("ownerId") or 0)
            conversation_value = decoded.get("conversationId")
            conversation_id = (
                int(conversation_value) if conversation_value is not None else None
            )
            model_provider = str(decoded.get("modelProvider") or "deepseek")
            database_type = str(decoded.get("databaseType") or "postgresql")
            process_message(body)
            current_channel.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as error:
            logger.exception("task failed")
            try:
                if task_id is not None and owner_id is not None:
                    message = str(error)[:2000]
                    execution_trace = getattr(error, "execution_trace", [])
                    if not execution_trace:
                        execution_trace = [
                            {
                                "id": "execution_error",
                                "title": "执行任务",
                                "status": "failed",
                                "kind": "stage",
                                "detail": "任务执行失败",
                            }
                        ]
                    update_task(
                        task_id,
                        "failed",
                        result={"executionTrace": execution_trace},
                        error_message=message,
                    )
                    save_state(
                        task_id,
                        {
                            "id": task_id,
                            "ownerId": owner_id,
                            "status": "failed",
                            "conversationId": conversation_id,
                            "modelProvider": model_provider,
                            "databaseType": database_type,
                            "errorMessage": message,
                            "executionTrace": execution_trace,
                        },
                    )
                current_channel.basic_ack(delivery_tag=method.delivery_tag)
            except Exception:
                logger.exception("failed to persist error; task will be requeued")
                current_channel.basic_nack(
                    delivery_tag=method.delivery_tag, requeue=True
                )

    channel.basic_consume(queue=queue, on_message_callback=callback)
    redis_client.ping()
    worker_ready = True
    logger.info("worker is ready: queue=%s prefetch=1", queue)
    channel.start_consuming()


def main() -> None:
    """启动健康端口，并在连接中断时自动重试。"""

    global worker_ready
    start_health_server()
    while True:
        try:
            consume()
        except KeyboardInterrupt:
            return
        except Exception:
            worker_ready = False
            logger.exception("worker connection failed; retrying in 5 seconds")
            time.sleep(5)


if __name__ == "__main__":
    main()

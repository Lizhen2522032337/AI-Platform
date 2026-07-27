"""从 RabbitMQ 消费任务，调用 FastAPI，并更新 PostgreSQL 与 Redis。"""

import json
import logging
import os
import threading
import time
import urllib.request
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
    """把最新任务状态写入 Redis，供 Gin 实时接口读取。"""

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
) -> None:
    """更新任务持久化状态。"""

    with postgres_connection() as connection:
        connection.execute(
            """
            UPDATE ai_tasks
            SET status = %s,
                result = %s::jsonb,
                error_message = %s,
                object_key = %s,
                vector_id = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (
                status,
                json.dumps(result, ensure_ascii=False) if result else None,
                error_message,
                result.get("objectKey") if result else None,
                result.get("vectorId") if result else None,
                task_id,
            ),
        )


def call_ai_service(task_id: int, prompt: str) -> dict[str, Any]:
    """调用内部 FastAPI AI 服务。"""

    base_url = os.getenv("AI_SERVICE_URL", "http://fastapi-service:8000")
    body = json.dumps({"taskId": task_id, "prompt": prompt}).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/process",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def process_message(body: bytes) -> None:
    """执行单个队列任务。"""

    message = json.loads(body.decode("utf-8"))
    task_id = int(message["id"])
    # 兼容认证功能上线前已经进入队列的旧消息；0 表示无归属，仅管理员可查看。
    owner_id = int(message.get("ownerId") or 0)
    prompt = str(message["prompt"])
    processing_state = {
        "id": task_id,
        "ownerId": owner_id,
        "status": "processing",
    }
    update_task(task_id, "processing")
    save_state(task_id, processing_state)

    result = call_ai_service(task_id, prompt)
    update_task(task_id, "completed", result=result)
    save_state(
        task_id,
        {
            "id": task_id,
            "ownerId": owner_id,
            "status": "completed",
            "result": result,
        },
    )
    logger.info("task completed: %s", task_id)


class HealthHandler(BaseHTTPRequestHandler):
    """为 Docker 提供极简健康检查。"""

    def do_GET(self) -> None:  # noqa: N802
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
    connection = pika.BlockingConnection(parameters)
    channel = connection.channel()
    queue = os.getenv("RABBITMQ_TASK_QUEUE", "ai_tasks")
    channel.queue_declare(
        queue=queue,
        durable=True,
        arguments={"x-queue-type": "quorum"},
    )
    channel.basic_qos(prefetch_count=1)

    def callback(
        current_channel: pika.channel.Channel,
        method: pika.spec.Basic.Deliver,
        _: pika.spec.BasicProperties,
        body: bytes,
    ) -> None:
        task_id: int | None = None
        owner_id: int | None = None
        try:
            decoded = json.loads(body.decode("utf-8"))
            task_id = int(decoded["id"])
            owner_id = int(decoded.get("ownerId") or 0)
            process_message(body)
            current_channel.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as error:  # noqa: BLE001
            logger.exception("task failed")
            try:
                if task_id is not None and owner_id is not None:
                    message = str(error)[:2000]
                    update_task(task_id, "failed", error_message=message)
                    save_state(
                        task_id,
                        {
                            "id": task_id,
                            "ownerId": owner_id,
                            "status": "failed",
                            "errorMessage": message,
                        },
                    )
                current_channel.basic_ack(delivery_tag=method.delivery_tag)
            except Exception:  # noqa: BLE001
                logger.exception("failed to persist error; task will be requeued")
                current_channel.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

    channel.basic_consume(queue=queue, on_message_callback=callback)
    redis_client.ping()
    worker_ready = True
    logger.info("worker is ready; queue=%s", queue)
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
        except Exception:  # noqa: BLE001
            worker_ready = False
            logger.exception("worker connection failed; retrying in 5 seconds")
            time.sleep(5)


if __name__ == "__main__":
    main()

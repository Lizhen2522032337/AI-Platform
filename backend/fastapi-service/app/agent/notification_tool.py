"""消息通知 Tool：默认关闭的通用 Webhook 适配器。"""

import logging

import httpx

from app.config.settings import Settings, get_settings

logger = logging.getLogger(__name__)


class NotificationToolError(RuntimeError):
    """不包含 Webhook 地址或服务响应正文的通知错误。"""


async def send_notification(
    task_id: int,
    title: str,
    summary: str,
    artifacts: list[dict[str, object]],
    settings: Settings | None = None,
) -> bool:
    """仅当两项开关和 Webhook 都已配置时发送结构化通知。"""

    current = settings or get_settings()
    if not current.notification_enabled or not current.notification_auto_send:
        return False
    if current.notification_webhook_url is None:
        raise NotificationToolError("通知已启用，但未配置 Webhook")
    url = current.notification_webhook_url.get_secret_value().strip()
    if not url:
        raise NotificationToolError("通知已启用，但 Webhook 为空")
    payload = {
        "event": "enterprise_ai_report_ready",
        "taskId": task_id,
        "title": title,
        "summary": summary[:2000],
        "artifacts": [
            {
                "name": artifact.get("name"),
                "kind": artifact.get("kind"),
                "objectKey": artifact.get("objectKey"),
            }
            for artifact in artifacts
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=current.notification_timeout_seconds) as client:
            response = await client.post(url, json=payload)
        if response.status_code >= 400:
            raise NotificationToolError(
                f"通知服务拒绝请求（HTTP {response.status_code}）"
            )
        logger.info("Agent notification sent: task_id=%s", task_id)
        return True
    except NotificationToolError:
        raise
    except httpx.HTTPError as error:
        logger.warning(
            "Agent notification failed: task_id=%s error_type=%s",
            task_id,
            type(error).__name__,
        )
        raise NotificationToolError("无法连接通知服务") from error


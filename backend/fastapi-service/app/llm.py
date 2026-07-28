"""DeepSeek 与通义千问的 OpenAI 兼容流式调用。"""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal, TypedDict

import httpx

from app.config.settings import Settings, get_settings


ModelProvider = Literal["deepseek", "qwen"]


class ChatMessage(TypedDict):
    """发送给大模型的标准历史消息。"""

    role: Literal["user", "assistant"]
    content: str


@dataclass(frozen=True)
class ProviderConfig:
    """单个模型供应商的服务端配置。"""

    provider: ModelProvider
    display_name: str
    base_url: str
    api_key: str
    model: str


class LlmProviderError(RuntimeError):
    """可安全返回给内部 Worker 的大模型调用错误。"""


def provider_config(provider: ModelProvider, settings: Settings | None = None) -> ProviderConfig:
    """把前端可选的供应商映射到服务端固定配置，禁止客户端传 URL 和 Key。"""

    current = settings or get_settings()
    if provider == "deepseek":
        return ProviderConfig(
            provider=provider,
            display_name="DeepSeek",
            base_url=current.deepseek_base_url.rstrip("/"),
            api_key=current.deepseek_api_key.get_secret_value(),
            model=current.deepseek_model,
        )
    if provider == "qwen":
        return ProviderConfig(
            provider=provider,
            display_name="通义千问",
            base_url=current.qwen_base_url.rstrip("/"),
            api_key=current.qwen_api_key.get_secret_value(),
            model=current.qwen_model,
        )
    raise LlmProviderError("unsupported model provider")


async def stream_chat(
    provider: ModelProvider,
    messages: list[ChatMessage],
) -> AsyncIterator[dict[str, Any]]:
    """调用供应商的 Chat Completions SSE，并产出统一的增量事件。"""

    settings = get_settings()
    config = provider_config(provider, settings)
    request_body = {
        "model": config.model,
        "messages": [
            {
                "role": "system",
                "content": "你是企业 AI 助手。请准确、清晰地回答用户问题；不知道时明确说明。",
            },
            *messages,
        ],
        "stream": True,
        "stream_options": {"include_usage": True},
        "max_tokens": settings.llm_max_tokens,
    }
    # 当前界面只展示最终回答，因此关闭两家模型的思考模式，避免长时间无可见输出。
    if provider == "deepseek":
        request_body["thinking"] = {"type": "disabled"}
    else:
        request_body["enable_thinking"] = False
    timeout = httpx.Timeout(settings.llm_request_timeout_seconds, connect=15.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{config.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                },
                json=request_body,
            ) as response:
                if response.status_code >= 400:
                    # 不透传供应商响应体，避免把内部细节或敏感内容写入任务记录。
                    raise LlmProviderError(
                        f"{config.display_name} 调用失败（HTTP {response.status_code}）"
                    )
                yield {
                    "type": "start",
                    "provider": config.provider,
                    "model": config.model,
                }
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError as error:
                        raise LlmProviderError("大模型返回了无法解析的流式数据") from error
                    choices = chunk.get("choices") or []
                    if choices:
                        # 只展示最终回答 content，不展示模型的内部推理内容。
                        content = (choices[0].get("delta") or {}).get("content")
                        if content:
                            yield {"type": "delta", "text": str(content)}
                    usage = chunk.get("usage")
                    if usage:
                        yield {"type": "usage", "usage": usage}
    except LlmProviderError:
        raise
    except httpx.TimeoutException as error:
        raise LlmProviderError(f"{config.display_name} 响应超时") from error
    except httpx.HTTPError as error:
        raise LlmProviderError(f"无法连接 {config.display_name}") from error

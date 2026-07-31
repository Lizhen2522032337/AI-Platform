"""Dify Knowledge API 客户端。

调用链只发生在 FastAPI 容器内部：用户问题用于检索，命中的文本块作为参考资料
交给大模型。API Key、问题正文和知识库正文都不会写入日志。
"""

import logging
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app.config.settings import Settings, get_settings

logger = logging.getLogger(__name__)


class DifyKnowledgeError(RuntimeError):
    """可以安全传回 Worker 的知识库检索错误，不包含 Dify 响应正文。"""


@dataclass(frozen=True)
class KnowledgeResult:
    """经过过滤和长度限制后，可直接注入系统提示词的检索结果。"""

    enabled: bool
    context: str
    hit_count: int


def _required_configuration(settings: Settings) -> tuple[str, str]:
    """只在启用 Dify 时校验密钥和知识库 ID，保证未启用时兼容旧部署。"""

    api_key = (
        settings.dify_api_key.get_secret_value()
        if settings.dify_api_key is not None
        else ""
    )
    dataset_id = (settings.dify_dataset_id or "").strip()
    if not api_key or not dataset_id:
        raise DifyKnowledgeError(
            "Dify 知识库已启用，但 DIFY_API_KEY 或 DIFY_DATASET_ID 未配置"
        )
    return api_key, dataset_id


def _format_records(records: object, settings: Settings) -> tuple[str, int]:
    """提取 Dify 文本块，按分数过滤，并限制注入大模型的总字符数。"""

    if not isinstance(records, list):
        raise DifyKnowledgeError("Dify 知识库返回了无效数据")

    blocks: list[str] = []
    used_chars = 0
    top_k = max(1, min(settings.dify_top_k, 20))
    max_chars = max(1000, min(settings.dify_max_context_chars, 50000))
    threshold = max(0.0, min(settings.dify_score_threshold, 1.0))

    for record in records:
        if not isinstance(record, dict):
            continue
        score_value = record.get("score")
        try:
            score = float(score_value) if score_value is not None else 0.0
        except (TypeError, ValueError):
            score = 0.0
        if score < threshold:
            continue

        segment = record.get("segment")
        if not isinstance(segment, dict):
            continue
        content = str(segment.get("content") or "").strip()
        # Dify 的 Q&A 分段通常把问题放在 content、答案放在 answer；
        # 部分版本会额外返回 question，因此优先使用 question 并兼容 content。
        question = str(segment.get("question") or content).strip()
        answer = str(segment.get("answer") or "").strip()

        if answer:
            content = f"问题：{question}\n答案：{answer}"
        elif not content:
            continue
        document = segment.get("document")
        source = (
            str(document.get("name") or "未知文档")
            if isinstance(document, dict)
            else "未知文档"
        )
        # 来源名用于回答时引用；不写入服务日志，避免泄露内部文档信息。
        header = f"[知识库 {len(blocks) + 1}｜来源：{source}｜相关度：{score:.3f}]"
        remaining = max_chars - used_chars - len(header) - 1
        if remaining <= 0:
            break
        block = f"{header}\n{content[:remaining]}"
        blocks.append(block)
        used_chars += len(block)
        if len(blocks) >= top_k or used_chars >= max_chars:
            break

    return "\n\n".join(blocks), len(blocks)


async def retrieve_knowledge(
    query: str,
    settings: Settings | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> KnowledgeResult:
    """检索与当前问题相关的知识块；Dify 未启用时返回空上下文。"""

    current = settings or get_settings()
    if not current.dify_enabled:
        return KnowledgeResult(enabled=False, context="", hit_count=0)

    api_key, dataset_id = _required_configuration(current)
    # Dify 官方限制 query 最长 250 字符；这里保留当前问题的开头用于检索。
    search_query = query.strip()[:250]
    if not search_query:
        raise DifyKnowledgeError("Dify 知识库检索问题不能为空")

    base_url = current.dify_base_url.rstrip("/")
    url = f"{base_url}/datasets/{quote(dataset_id, safe='')}/retrieve"
    timeout = httpx.Timeout(current.dify_request_timeout_seconds, connect=10.0)
    started = time.monotonic()
    # 日志只保留 ID 尾部用于排查配置，不输出完整 Dataset ID。
    dataset_ref = dataset_id[-8:]
    logger.info(
        "Dify knowledge retrieval started: dataset_ref=%s query_chars=%d",
        dataset_ref,
        len(search_query),
    )
    try:
        # transport 仅供单元测试注入 MockTransport；生产环境保持 None，使用真实 HTTPS。
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                # 使用知识库自身的检索设置，再在本地执行 top_k 和阈值过滤，减少 API 版本耦合。
                json={"query": search_query},
            )
        if response.status_code >= 400:
            logger.warning(
                "Dify knowledge retrieval rejected: dataset_ref=%s status=%d",
                dataset_ref,
                response.status_code,
            )
            raise DifyKnowledgeError(
                f"Dify 知识库检索失败（HTTP {response.status_code}）"
            )
        try:
            body: Any = response.json()
        except ValueError as error:
            raise DifyKnowledgeError("Dify 知识库返回了无法解析的数据") from error
        if not isinstance(body, dict):
            raise DifyKnowledgeError("Dify 知识库返回了无效数据")
        context, hit_count = _format_records(body.get("records"), current)
        elapsed_ms = round((time.monotonic() - started) * 1000)
        logger.info(
            "Dify knowledge retrieval completed: dataset_ref=%s hits=%d elapsed_ms=%d",
            dataset_ref,
            hit_count,
            elapsed_ms,
        )
        return KnowledgeResult(enabled=True, context=context, hit_count=hit_count)
    except DifyKnowledgeError:
        raise
    except httpx.TimeoutException as error:
        logger.warning("Dify knowledge retrieval timed out: dataset_ref=%s", dataset_ref)
        raise DifyKnowledgeError("Dify 知识库检索超时") from error
    except httpx.HTTPError as error:
        logger.warning(
            "Dify knowledge retrieval connection failed: dataset_ref=%s error_type=%s",
            dataset_ref,
            type(error).__name__,
        )
        raise DifyKnowledgeError("无法连接 Dify 知识库") from error

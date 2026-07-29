"""Dify 知识库配置校验和检索结果整理测试。"""

import asyncio
import json

import httpx
import pytest

from app.config.settings import Settings
from app.dify import DifyKnowledgeError, _format_records, retrieve_knowledge


def settings(**overrides) -> Settings:
    """构造不包含真实密钥的测试配置。"""

    values = {
        "minio_root_user": "test-user",
        "minio_root_password": "test-password",
        "deepseek_api_key": "test-deepseek-key",
        "qwen_api_key": "test-qwen-key",
        "qwen_base_url": "https://example.invalid/v1",
    }
    values.update(overrides)
    return Settings(**values)


def test_format_records_filters_score_and_limits_top_k() -> None:
    config = settings(dify_top_k=1, dify_score_threshold=0.5)
    context, hits = _format_records(
        [
            {
                "score": 0.91,
                "segment": {
                    "content": "第一条知识",
                    "document": {"name": "软考资料.txt"},
                },
            },
            {
                "score": 0.20,
                "segment": {"content": "低分知识"},
            },
        ],
        config,
    )
    assert hits == 1
    assert "第一条知识" in context
    assert "软考资料.txt" in context
    assert "低分知识" not in context


def test_retrieve_returns_empty_context_when_disabled() -> None:
    result = asyncio.run(retrieve_knowledge("什么是软件设计师考试？", settings()))
    assert result.enabled is False
    assert result.hit_count == 0
    assert result.context == ""


def test_retrieve_requires_secret_and_dataset_when_enabled() -> None:
    with pytest.raises(DifyKnowledgeError, match="DIFY_API_KEY"):
        asyncio.run(retrieve_knowledge("测试问题", settings(dify_enabled=True)))


def test_retrieve_calls_dify_without_exposing_key_in_result() -> None:
    """验证 URL、Bearer 鉴权、查询内容和响应解析，不访问真实 Dify。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/datasets/dataset-id/retrieve"
        assert request.headers["Authorization"] == "Bearer test-dify-key"
        assert json.loads(request.content) == {"query": "软考是什么？"}
        return httpx.Response(
            200,
            json={
                "records": [
                    {
                        "score": 0.88,
                        "segment": {
                            "content": "软件资格考试相关资料",
                            "document": {"name": "软考.txt"},
                        },
                    }
                ]
            },
        )

    config = settings(
        dify_enabled=True,
        dify_api_key="test-dify-key",
        dify_dataset_id="dataset-id",
    )
    result = asyncio.run(
        retrieve_knowledge(
            "软考是什么？",
            config,
            transport=httpx.MockTransport(handler),
        )
    )
    assert result.enabled is True
    assert result.hit_count == 1
    assert "软件资格考试相关资料" in result.context
    assert "test-dify-key" not in result.context

"""自建 RAG 热配置、文本分块和文件解析边界测试。"""

import json

import pytest
from app.config.settings import Settings
from app.knowledge import (
    KnowledgeBaseError,
    _chunks,
    _extract_text,
    load_knowledge_config,
)


def settings(config_file: str) -> Settings:
    return Settings(
        minio_root_user="test-user",
        minio_root_password="test-password",
        deepseek_api_key="test-deepseek-key",
        qwen_api_key="test-qwen-key",
        qwen_base_url="https://example.invalid/v1",
        knowledge_config_file=config_file,
    )


def test_hot_config_is_read_again_after_file_change(tmp_path) -> None:
    path = tmp_path / "knowledge.json"
    path.write_text(json.dumps({"top_k": 3}), encoding="utf-8")
    current = settings(str(path))
    assert load_knowledge_config(current).top_k == 3

    path.write_text(json.dumps({"top_k": 8}), encoding="utf-8")
    assert load_knowledge_config(current).top_k == 8


def test_config_rejects_overlap_larger_than_chunk(tmp_path) -> None:
    path = tmp_path / "knowledge.json"
    path.write_text(
        json.dumps({"chunk_size": 300, "chunk_overlap": 300}), encoding="utf-8"
    )
    with pytest.raises(KnowledgeBaseError, match="chunk_overlap"):
        load_knowledge_config(settings(str(path)))


def test_chunks_keep_overlap_for_long_text() -> None:
    chunks = _chunks("甲" * 650, size=300, overlap=50)
    assert len(chunks) == 3
    assert chunks[0][-50:] == chunks[1][:50]


def test_plain_text_requires_utf8() -> None:
    with pytest.raises(KnowledgeBaseError, match="UTF-8"):
        _extract_text("legacy.txt", b"\xff\xfe\x00")

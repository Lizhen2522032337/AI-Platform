"""AI 示例处理流程以及 Qdrant、MinIO 集成。"""

import hashlib
import io
import json
import logging
from functools import lru_cache

from minio import Minio
from qdrant_client import QdrantClient, models

from app.config.settings import get_settings


logger = logging.getLogger(__name__)


@lru_cache
def qdrant_client() -> QdrantClient:
    """创建并缓存 Qdrant 客户端。"""

    return QdrantClient(url=get_settings().qdrant_url, timeout=5)


@lru_cache
def minio_client() -> Minio:
    """创建并缓存 MinIO 客户端。"""

    settings = get_settings()
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_root_user,
        secret_key=settings.minio_root_password,
        secure=settings.minio_use_ssl,
    )


def check_integrations() -> None:
    """检查 Qdrant 和 MinIO 是否可用。"""

    qdrant_client().get_collections()
    minio_client().list_buckets()
    logger.debug("AI storage dependency health check succeeded")


def _vector_for(text: str) -> list[float]:
    """生成固定 8 维演示向量。

    这是可重复的占位实现，不具备语义检索能力；Dify 承担当前真正的知识检索。
    """

    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return [round(value / 255, 6) for value in digest[:8]]


def save_result(
    task_id: int,
    prompt: str,
    answer: str,
    provider: str,
    model: str,
    usage: dict[str, object] | None = None,
) -> dict[str, object]:
    """保存完整回答，将检索向量写入 Qdrant、结果 JSON 写入 MinIO。"""

    settings = get_settings()
    vector = _vector_for(f"{prompt}\n{answer}")
    vector_id = str(task_id)
    object_key = f"tasks/{task_id}/result.json"

    qdrant = qdrant_client()
    if not qdrant.collection_exists(settings.qdrant_collection):
        logger.info(
            "creating Qdrant collection: collection=%s dimensions=%d",
            settings.qdrant_collection,
            len(vector),
        )
        qdrant.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=models.VectorParams(
                size=len(vector), distance=models.Distance.COSINE
            ),
        )
    qdrant.upsert(
        collection_name=settings.qdrant_collection,
        points=[
            models.PointStruct(
                id=task_id,
                vector=vector,
                payload={
                    "taskId": task_id,
                    "prompt": prompt,
                    "answer": answer,
                    "provider": provider,
                    "model": model,
                },
            )
        ],
        wait=True,
    )
    logger.info("Qdrant result indexed: task_id=%s vector_id=%s", task_id, vector_id)

    result = {
        "taskId": task_id,
        "text": answer,
        "provider": provider,
        "model": model,
        "usage": usage or {},
        "vectorId": vector_id,
        "objectKey": object_key,
    }
    payload = json.dumps(result, ensure_ascii=False).encode("utf-8")
    storage = minio_client()
    if not storage.bucket_exists(settings.minio_bucket):
        logger.info("creating MinIO bucket: bucket=%s", settings.minio_bucket)
        storage.make_bucket(settings.minio_bucket)
    storage.put_object(
        settings.minio_bucket,
        object_key,
        io.BytesIO(payload),
        length=len(payload),
        content_type="application/json",
    )
    logger.info(
        "MinIO result saved: task_id=%s bucket=%s object_key=%s bytes=%d",
        task_id,
        settings.minio_bucket,
        object_key,
        len(payload),
    )
    return result

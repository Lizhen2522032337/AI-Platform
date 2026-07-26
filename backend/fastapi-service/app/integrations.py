"""AI 示例处理流程以及 Qdrant、MinIO 集成。"""

import hashlib
import io
import json
from functools import lru_cache

from minio import Minio
from qdrant_client import QdrantClient, models

from app.config.settings import get_settings


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


def _vector_for(text: str) -> list[float]:
    """生成固定 8 维演示向量；以后可替换为真实 Embedding 模型。"""

    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return [round(value / 255, 6) for value in digest[:8]]


def process_prompt(task_id: int, prompt: str) -> dict[str, object]:
    """处理任务，将向量写入 Qdrant、结果文件写入 MinIO。"""

    settings = get_settings()
    vector = _vector_for(prompt)
    result_text = f"AI 服务已处理：{prompt}"
    vector_id = str(task_id)
    object_key = f"tasks/{task_id}/result.json"

    qdrant = qdrant_client()
    if not qdrant.collection_exists(settings.qdrant_collection):
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
                payload={"taskId": task_id, "prompt": prompt},
            )
        ],
        wait=True,
    )

    result = {
        "taskId": task_id,
        "text": result_text,
        "vectorId": vector_id,
        "objectKey": object_key,
    }
    payload = json.dumps(result, ensure_ascii=False).encode("utf-8")
    storage = minio_client()
    if not storage.bucket_exists(settings.minio_bucket):
        storage.make_bucket(settings.minio_bucket)
    storage.put_object(
        settings.minio_bucket,
        object_key,
        io.BytesIO(payload),
        length=len(payload),
        content_type="application/json",
    )
    return result

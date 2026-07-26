"""从环境变量读取 AI 服务依赖配置。"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Qdrant 与 MinIO 配置，敏感值由仓库外 platform.env 注入。"""

    model_config = SettingsConfigDict(case_sensitive=False)

    qdrant_url: str = "http://qdrant:6333"
    qdrant_collection: str = "ai_task_vectors"
    minio_endpoint: str = "minio:9000"
    minio_root_user: str
    minio_root_password: str
    minio_bucket: str = "ai-results"
    minio_use_ssl: bool = False


@lru_cache
def get_settings() -> Settings:
    """缓存环境配置。"""

    return Settings()

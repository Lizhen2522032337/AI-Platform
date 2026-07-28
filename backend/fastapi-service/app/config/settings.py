"""从环境变量读取 AI 服务依赖及大模型配置。"""

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """AI 服务配置；大模型密钥由仓库外 llm.env 单独注入。"""

    model_config = SettingsConfigDict(case_sensitive=False)

    qdrant_url: str = "http://qdrant:6333"
    qdrant_collection: str = "ai_task_vectors"
    minio_endpoint: str = "minio:9000"
    minio_root_user: str
    minio_root_password: str
    minio_bucket: str = "ai-results"
    minio_use_ssl: bool = False
    deepseek_api_key: SecretStr
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"
    qwen_api_key: SecretStr
    qwen_base_url: str
    qwen_model: str = "qwen-plus"
    llm_request_timeout_seconds: float = 300
    llm_max_tokens: int = 2048


@lru_cache
def get_settings() -> Settings:
    """缓存环境配置。"""

    return Settings()

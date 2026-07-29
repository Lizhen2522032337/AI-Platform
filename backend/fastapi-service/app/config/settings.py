"""集中读取 FastAPI 的基础设施、大模型和 Dify 知识库配置。

真实密钥全部由虚拟机上的 ``/etc/enterprise-ai-platform/llm.env`` 注入。
本模块只声明配置结构，不把密钥打印到日志，也不允许浏览器直接获取配置。
"""

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """AI 服务配置；字段名会自动映射同名的大写环境变量。"""

    model_config = SettingsConfigDict(case_sensitive=False)

    # AI 结果的向量索引和原始 JSON 存储。
    qdrant_url: str = "http://qdrant:6333"
    qdrant_collection: str = "ai_task_vectors"
    minio_endpoint: str = "minio:9000"
    minio_root_user: str
    minio_root_password: str
    minio_bucket: str = "ai-results"
    minio_use_ssl: bool = False
    # 两家模型供应商都使用服务端密钥，前端只能提交 provider 枚举值。
    deepseek_api_key: SecretStr
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"
    qwen_api_key: SecretStr
    qwen_base_url: str
    qwen_model: str = "qwen-plus"

    # Dify Knowledge API。关闭时保持原有直接调用大模型的行为。
    # 开启时必须同时配置 API Key 和 Dataset ID。
    dify_enabled: bool = False
    dify_api_key: SecretStr | None = None
    dify_base_url: str = "https://api.dify.ai/v1"
    dify_dataset_id: str | None = None
    dify_top_k: int = 4
    dify_score_threshold: float = 0.3
    dify_request_timeout_seconds: float = 20
    dify_max_context_chars: int = 12000

    # 单次大模型调用的超时和最大输出长度，用于限制资源占用和费用。
    llm_request_timeout_seconds: float = 300
    llm_max_tokens: int = 2048


@lru_cache
def get_settings() -> Settings:
    """缓存配置，避免每个流式 token 都重复解析环境变量。"""

    return Settings()

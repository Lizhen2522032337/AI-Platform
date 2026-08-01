"""集中读取 FastAPI 的基础设施、大模型和 Dify 知识库配置。

真实密钥由虚拟机上的 ``llm.env`` 和 ``agent.env`` 注入。
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

    # LangGraph Agent 的执行边界。Planner 只能选择外部目录中登记的查询，
    # 不能把模型生成的任意 SQL 直接交给生产 DB2。
    agent_enabled: bool = True
    agent_max_queries: int = 6
    agent_max_evidence_chars: int = 24000
    # 动态 SQL 第一阶段只允许管理员查询内置平台用户白名单。
    dynamic_sql_enabled: bool = True
    dynamic_sql_max_rows: int = 200

    # Agent 数据库连接统一由虚拟机 Git 外配置注入。PostgreSQL 默认使用 Compose
    # 服务名 postgres；DB2 默认关闭，未提供配置时仍可使用 Dify 完成普通问答。
    postgres_enabled: bool = True
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "enterprise_ai_platform"
    postgres_user: str = "enterprise_ai"
    postgres_password: SecretStr | None = None
    postgres_sslmode: str = "disable"
    postgres_query_timeout_seconds: int = 30
    postgres_max_rows: int = 500

    db2_enabled: bool = False
    db2_dsn: SecretStr | None = None
    db2_catalog_file: str = "/etc/enterprise-ai-platform/db2-catalog.json"
    db2_query_timeout_seconds: int = 30
    db2_max_rows: int = 500
    # 新配置优先使用通用目录；为空时兼容原有 DB2_CATALOG_FILE。
    database_catalog_file: str | None = None

    # 报告文件默认写入现有 MinIO。通知使用通用 Webhook，且默认不自动发送，
    # 后续确定企业微信、钉钉或其他渠道后可替换适配器。
    report_files_enabled: bool = True
    notification_enabled: bool = False
    notification_auto_send: bool = False
    notification_webhook_url: SecretStr | None = None
    notification_timeout_seconds: float = 10

    # 单次大模型调用的超时和最大输出长度，用于限制资源占用和费用。
    llm_request_timeout_seconds: float = 300
    llm_max_tokens: int = 2048


@lru_cache
def get_settings() -> Settings:
    """缓存配置，避免每个流式 token 都重复解析环境变量。"""

    return Settings()

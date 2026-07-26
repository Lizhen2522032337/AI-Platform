"""从环境变量读取 FastAPI 服务配置。"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    """PostgreSQL 连接参数。"""

    model_config = SettingsConfigDict(case_sensitive=False)

    postgres_host: str = "host.docker.internal"
    postgres_port: int = 5432
    postgres_db: str = "enterprise_ai_platform"
    postgres_user: str = "postgres"
    postgres_password: str
    postgres_sslmode: str = "disable"

    @property
    def database_url(self) -> URL:
        """使用 SQLAlchemy URL 安全组装连接参数。"""

        return URL.create(
            drivername="postgresql+psycopg",
            username=self.postgres_user,
            password=self.postgres_password,
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
            query={"sslmode": self.postgres_sslmode},
        )


@lru_cache
def get_settings() -> Settings:
    """缓存配置，避免重复解析环境变量。"""

    return Settings()

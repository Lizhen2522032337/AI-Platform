"""数据库连接池与请求级会话。"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config.settings import get_settings


settings = get_settings()
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    connect_args={"connect_timeout": 5},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """SQLAlchemy 声明式模型基类。"""


def get_db() -> Generator[Session, None, None]:
    """为每个 HTTP 请求提供独立数据库会话。"""

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

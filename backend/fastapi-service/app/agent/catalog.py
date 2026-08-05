"""读取 Git 仓库之外的数据库字典与批准查询目录。"""

import json
import logging
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from app.agent.types import DatabaseType
from app.config.settings import Settings, get_settings

logger = logging.getLogger(__name__)


class CatalogParameter(BaseModel):
    """查询模板的命名参数；顺序决定 DB2 参数绑定位置。"""

    name: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
    description: str = Field(min_length=1, max_length=500)
    type: Literal["string", "integer", "number", "boolean"] = "string"
    required: bool = True


class CatalogQuery(BaseModel):
    """由业务和数据库负责人审核后允许 Agent 调用的只读 SQL。

    新目录将 ``sql`` 写成按方言区分的对象。旧目录中的字符串 SQL 仍被视为
    DB2 SQL，避免升级后错误地把 DB2 语法发送给 PostgreSQL。
    """

    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,99}$")
    description: str = Field(min_length=1, max_length=1000)
    sql: str | dict[DatabaseType, str]
    parameters: list[CatalogParameter] = Field(default_factory=list, max_length=30)
    result_description: str = Field(default="", max_length=2000)
    max_rows: int | None = Field(default=None, ge=1, le=5000)

    def sql_for(self, database_type: DatabaseType) -> str | None:
        if isinstance(self.sql, str):
            return self.sql if database_type == "db2" else None
        return self.sql.get(database_type)

    def supports(self, database_type: DatabaseType) -> bool:
        sql = self.sql_for(database_type)
        return bool(sql and sql.strip())


class CatalogColumn(BaseModel):
    """给 Planner 理解业务含义的列说明，不包含真实数据。"""

    name: str
    data_type: str = ""
    description: str
    sensitive: bool = False


class CatalogTable(BaseModel):
    """DB2 表或视图的业务字典。"""

    schema_name: str = Field(alias="schema")
    name: str
    description: str
    columns: list[CatalogColumn] = Field(default_factory=list)
    databases: list[DatabaseType] = Field(
        default_factory=lambda: ["postgresql", "db2"]
    )


class QueryCatalog(BaseModel):
    """Agent 可见的业务字典和可执行查询白名单。"""

    version: str = "1"
    tables: list[CatalogTable] = Field(default_factory=list)
    queries: list[CatalogQuery] = Field(default_factory=list)

    def query_by_id(self, query_id: str) -> CatalogQuery | None:
        return next((query for query in self.queries if query.id == query_id), None)

    def planner_summary(self, database_type: DatabaseType) -> dict[str, object]:
        """只向 Planner 暴露用途和参数，不暴露 SQL 文本或敏感列。"""

        return {
            "tables": [
                {
                    "schema": table.schema_name,
                    "name": table.name,
                    "description": table.description,
                    "columns": [
                        {
                            "name": column.name,
                            "type": column.data_type,
                            "description": column.description,
                        }
                        for column in table.columns
                        if not column.sensitive
                    ],
                }
                for table in self.tables
                if database_type in table.databases
            ],
            "approved_queries": [
                {
                    "id": query.id,
                    "description": query.description,
                    "parameters": [parameter.model_dump() for parameter in query.parameters],
                    "result_description": query.result_description,
                }
                for query in self.queries
                if query.supports(database_type)
            ],
        }


def load_query_catalog(settings: Settings | None = None) -> QueryCatalog:
    """每次任务读取目录，使运维更新目录后不必重建 FastAPI 镜像。"""

    current = settings or get_settings()
    path = Path(current.database_catalog_file or current.db2_catalog_file)
    try:
        if not path.is_file():
            logger.warning("Database query catalog not found: path=%s", path)
            return QueryCatalog()
        body = json.loads(path.read_text(encoding="utf-8"))
        catalog = QueryCatalog.model_validate(body)
    except (OSError, ValueError, ValidationError) as error:
        logger.error(
            "Database query catalog invalid: path=%s error_type=%s",
            path,
            type(error).__name__,
        )
        return QueryCatalog()
    logger.info(
        "Database query catalog loaded: version=%s tables=%d queries=%d",
        catalog.version,
        len(catalog.tables),
        len(catalog.queries),
    )
    return catalog

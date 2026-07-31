"""旧 DB2 Tool 兼容层；新代码统一使用通用数据库 Tool。"""

from typing import Any

from app.agent.catalog import CatalogQuery
from app.agent.database_tool import DatabaseToolError as Db2ToolError
from app.agent.database_tool import assert_read_only_sql as _assert_read_only_sql
from app.agent.database_tool import execute_catalog_query as _execute_catalog_query
from app.config.settings import Settings


def execute_catalog_query(
    query: CatalogQuery,
    parameters: dict[str, object],
    settings: Settings | None = None,
) -> dict[str, Any]:
    """兼容旧调用签名，并明确选择 DB2 方言。"""

    return _execute_catalog_query(query, parameters, "db2", settings)


__all__ = ["Db2ToolError", "_assert_read_only_sql", "execute_catalog_query"]

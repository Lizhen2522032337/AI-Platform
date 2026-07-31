"""DB2 只读查询 Tool；只执行外部目录中预先批准的参数化 SQL。"""

import datetime as dt
import decimal
import logging
import re
from typing import Any

from app.agent.catalog import CatalogParameter, CatalogQuery
from app.config.settings import Settings, get_settings

logger = logging.getLogger(__name__)
_WRITE_PATTERN = re.compile(
    r"\b(insert|update|delete|merge|call|create|alter|drop|truncate|grant|revoke|execute|set)\b",
    re.IGNORECASE,
)


class Db2ToolError(RuntimeError):
    """可以安全交给 Planner/用户的 DB2 Tool 错误。"""


def _assert_read_only_sql(sql: str) -> None:
    normalized = sql.strip()
    if ";" in normalized.rstrip(";"):
        raise Db2ToolError("批准查询包含多条 SQL，已拒绝执行")
    if not re.match(r"^(select|with)\b", normalized, re.IGNORECASE):
        raise Db2ToolError("批准查询不是 SELECT/WITH 只读语句")
    if _WRITE_PATTERN.search(normalized):
        raise Db2ToolError("批准查询包含写入或管理关键字，已拒绝执行")


def _coerce_parameter(parameter: CatalogParameter, value: object) -> object:
    if value is None:
        if parameter.required:
            raise Db2ToolError(f"缺少查询参数：{parameter.name}")
        return None
    try:
        if parameter.type == "integer":
            return int(value)
        if parameter.type == "number":
            return float(value)
        if parameter.type == "boolean":
            if isinstance(value, bool):
                return value
            normalized = str(value).strip().lower()
            if normalized in {"true", "1", "yes"}:
                return True
            if normalized in {"false", "0", "no"}:
                return False
            raise ValueError
        return str(value)
    except (TypeError, ValueError) as error:
        raise Db2ToolError(
            f"查询参数类型不正确：{parameter.name} 应为 {parameter.type}"
        ) from error


def _json_value(value: object) -> object:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (dt.date, dt.datetime, dt.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, bytes):
        return f"<binary:{len(value)} bytes>"
    return str(value)


def execute_catalog_query(
    query: CatalogQuery,
    parameters: dict[str, object],
    settings: Settings | None = None,
) -> dict[str, Any]:
    """执行一条白名单查询，并返回经过行数限制和 JSON 化的结果。"""

    current = settings or get_settings()
    if not current.db2_enabled:
        raise Db2ToolError("DB2 Tool 尚未启用")
    if current.db2_dsn is None or not current.db2_dsn.get_secret_value().strip():
        raise Db2ToolError("DB2 Tool 已启用，但未配置 DB2_DSN")
    _assert_read_only_sql(query.sql)

    expected = {parameter.name for parameter in query.parameters}
    unexpected = sorted(set(parameters) - expected)
    if unexpected:
        raise Db2ToolError(f"查询包含未批准参数：{', '.join(unexpected)}")
    bound_values = [
        _coerce_parameter(parameter, parameters.get(parameter.name))
        for parameter in query.parameters
    ]
    row_limit = min(query.max_rows or current.db2_max_rows, current.db2_max_rows, 5000)

    # 延迟导入：未启用 DB2 时不要求开发机安装 IBM CLI Driver。
    try:
        import ibm_db  # type: ignore[import-not-found]
    except ImportError as error:
        raise Db2ToolError("FastAPI 镜像缺少 ibm_db 驱动") from error

    connection = None
    statement = None
    logger.info(
        "DB2 approved query started: query_id=%s parameters=%d max_rows=%d",
        query.id,
        len(bound_values),
        row_limit,
    )
    try:
        connection = ibm_db.connect(current.db2_dsn.get_secret_value(), "", "")
        statement = ibm_db.prepare(connection, query.sql)
        timeout_option = getattr(ibm_db, "SQL_ATTR_QUERY_TIMEOUT", None)
        if timeout_option is not None:
            ibm_db.set_option(
                statement,
                {timeout_option: current.db2_query_timeout_seconds},
                0,
            )
        for index, value in enumerate(bound_values, start=1):
            ibm_db.bind_param(statement, index, value)
        ibm_db.execute(statement)
        column_count = ibm_db.num_fields(statement)
        columns = [str(ibm_db.field_name(statement, index)) for index in range(column_count)]
        rows: list[dict[str, object]] = []
        truncated = False
        while True:
            row = ibm_db.fetch_tuple(statement)
            if row is False:
                break
            if len(rows) >= row_limit:
                truncated = True
                break
            rows.append(
                {columns[index]: _json_value(value) for index, value in enumerate(row)}
            )
        logger.info(
            "DB2 approved query completed: query_id=%s rows=%d truncated=%s",
            query.id,
            len(rows),
            truncated,
        )
        return {
            "queryId": query.id,
            "status": "ok",
            "description": query.result_description or query.description,
            "columns": columns,
            "rows": rows,
            "rowCount": len(rows),
            "truncated": truncated,
        }
    except Db2ToolError:
        raise
    except Exception as error:
        logger.warning(
            "DB2 approved query failed: query_id=%s error_type=%s",
            query.id,
            type(error).__name__,
        )
        raise Db2ToolError(f"DB2 查询失败：{query.id}") from error
    finally:
        if statement is not None:
            try:
                ibm_db.free_stmt(statement)
            except Exception as error:  # noqa: BLE001
                logger.debug("DB2 statement cleanup failed: error_type=%s", type(error).__name__)
        if connection is not None:
            try:
                ibm_db.close(connection)
            except Exception as error:  # noqa: BLE001
                logger.debug("DB2 connection cleanup failed: error_type=%s", type(error).__name__)

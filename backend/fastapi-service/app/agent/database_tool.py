"""统一只读数据库 Tool，支持 PostgreSQL 与 DB2 两种执行适配器。"""

import datetime as dt
import decimal
import logging
import re
from typing import Any

from app.agent.catalog import CatalogParameter, CatalogQuery
from app.agent.types import DatabaseType
from app.config.settings import Settings, get_settings

logger = logging.getLogger(__name__)
_WRITE_PATTERN = re.compile(
    r"\b(insert|update|delete|merge|call|create|alter|drop|truncate|grant|revoke|execute|set|copy)\b",
    re.IGNORECASE,
)
_NAMED_PARAMETER_PATTERN = re.compile(r"(?<!:):([A-Za-z][A-Za-z0-9_]{0,63})")


class DatabaseToolError(RuntimeError):
    """可以安全交给 Planner/用户的数据库 Tool 错误。"""


def assert_read_only_sql(sql: str) -> None:
    """阻止多语句、写入、DDL 和存储过程调用。"""

    normalized = sql.strip()
    if ";" in normalized.rstrip(";"):
        raise DatabaseToolError("批准查询包含多条 SQL，已拒绝执行")
    if not re.match(r"^(select|with)\b", normalized, re.IGNORECASE):
        raise DatabaseToolError("批准查询不是 SELECT/WITH 只读语句")
    if _WRITE_PATTERN.search(normalized):
        raise DatabaseToolError("批准查询包含写入或管理关键字，已拒绝执行")


def _coerce_parameter(parameter: CatalogParameter, value: object) -> object:
    if value is None:
        if parameter.required:
            raise DatabaseToolError(f"缺少查询参数：{parameter.name}")
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
        raise DatabaseToolError(
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


def _prepare_sql(
    sql: str,
    database_type: DatabaseType,
    parameter_definitions: list[CatalogParameter],
    parameters: dict[str, object],
) -> tuple[str, list[object]]:
    """把目录中的 ``:参数名`` 转成驱动占位符，并按出现顺序绑定值。"""

    definitions = {parameter.name: parameter for parameter in parameter_definitions}
    unexpected = sorted(set(parameters) - set(definitions))
    if unexpected:
        raise DatabaseToolError(f"查询包含未批准参数：{', '.join(unexpected)}")

    # 先校验所有声明参数，使缺少但 SQL 中未引用的必填参数也不能静默通过。
    coerced = {
        name: _coerce_parameter(definition, parameters.get(name))
        for name, definition in definitions.items()
    }
    names = _NAMED_PARAMETER_PATTERN.findall(sql)
    unknown = sorted(set(names) - set(definitions))
    if unknown:
        raise DatabaseToolError(f"SQL 使用未声明参数：{', '.join(unknown)}")
    if names:
        placeholder = "%s" if database_type == "postgresql" else "?"
        compiled = _NAMED_PARAMETER_PATTERN.sub(placeholder, sql)
        return compiled, [coerced[name] for name in names]

    # 兼容原 DB2 目录的问号占位符；新目录应统一使用 :参数名。
    if database_type == "db2" and "?" in sql:
        values = [coerced[definition.name] for definition in parameter_definitions]
        if sql.count("?") != len(values):
            raise DatabaseToolError("DB2 SQL 占位符数量与参数目录不一致")
        return sql, values
    if parameter_definitions:
        raise DatabaseToolError("SQL 声明了参数，但没有使用 :参数名 占位符")
    return sql, []


def _execute_postgresql(
    query: CatalogQuery,
    sql: str,
    values: list[object],
    row_limit: int,
    settings: Settings,
) -> tuple[list[str], list[dict[str, object]], bool]:
    if not settings.postgres_enabled:
        raise DatabaseToolError("PostgreSQL Tool 尚未启用")
    if settings.postgres_password is None:
        raise DatabaseToolError("PostgreSQL Tool 已启用，但未配置 POSTGRES_PASSWORD")
    try:
        import psycopg
    except ImportError as error:
        raise DatabaseToolError("FastAPI 镜像缺少 psycopg 驱动") from error

    try:
        with (
            psycopg.connect(
                host=settings.postgres_host,
                port=settings.postgres_port,
                dbname=settings.postgres_db,
                user=settings.postgres_user,
                password=settings.postgres_password.get_secret_value(),
                sslmode=settings.postgres_sslmode,
                connect_timeout=5,
                options=(
                    "-c statement_timeout="
                    f"{settings.postgres_query_timeout_seconds * 1000}"
                ),
            ) as connection,
            connection.transaction(),
            connection.cursor() as cursor,
        ):
            # 即使账号权限配置错误，也在会话级强制只读事务。
            connection.execute("SET TRANSACTION READ ONLY")
            cursor.execute(sql, values)
            columns = [column.name for column in cursor.description or []]
            raw_rows = cursor.fetchmany(row_limit + 1)
    except Exception as error:
        logger.warning(
            "PostgreSQL approved query failed: query_id=%s error_type=%s",
            query.id,
            type(error).__name__,
        )
        raise DatabaseToolError(f"PostgreSQL 查询失败：{query.id}") from error
    truncated = len(raw_rows) > row_limit
    rows = [
        {columns[index]: _json_value(value) for index, value in enumerate(row)}
        for row in raw_rows[:row_limit]
    ]
    return columns, rows, truncated


def _execute_db2(
    query: CatalogQuery,
    sql: str,
    values: list[object],
    row_limit: int,
    settings: Settings,
) -> tuple[list[str], list[dict[str, object]], bool]:
    if not settings.db2_enabled:
        raise DatabaseToolError("DB2 Tool 尚未启用")
    if settings.db2_dsn is None or not settings.db2_dsn.get_secret_value().strip():
        raise DatabaseToolError("DB2 Tool 已启用，但未配置 DB2_DSN")
    try:
        import ibm_db  # type: ignore[import-not-found]
    except ImportError as error:
        raise DatabaseToolError("FastAPI 镜像缺少 ibm_db 驱动") from error

    connection = None
    statement = None
    try:
        connection = ibm_db.connect(settings.db2_dsn.get_secret_value(), "", "")
        statement = ibm_db.prepare(connection, sql)
        timeout_option = getattr(ibm_db, "SQL_ATTR_QUERY_TIMEOUT", None)
        if timeout_option is not None:
            ibm_db.set_option(
                statement,
                {timeout_option: settings.db2_query_timeout_seconds},
                0,
            )
        for index, value in enumerate(values, start=1):
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
        return columns, rows, truncated
    except Exception as error:
        logger.warning(
            "DB2 approved query failed: query_id=%s error_type=%s",
            query.id,
            type(error).__name__,
        )
        raise DatabaseToolError(f"DB2 查询失败：{query.id}") from error
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


def execute_catalog_query(
    query: CatalogQuery,
    parameters: dict[str, object],
    database_type: DatabaseType,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """按用户选择的数据库方言执行同一业务查询 ID。"""

    current = settings or get_settings()
    sql = query.sql_for(database_type)
    if not sql:
        raise DatabaseToolError(
            f"查询 {query.id} 没有配置 {database_type} 方言 SQL"
        )
    assert_read_only_sql(sql)
    compiled_sql, values = _prepare_sql(
        sql,
        database_type,
        query.parameters,
        parameters,
    )
    configured_limit = (
        current.postgres_max_rows
        if database_type == "postgresql"
        else current.db2_max_rows
    )
    row_limit = min(query.max_rows or configured_limit, configured_limit, 5000)
    logger.info(
        "Approved database query started: database=%s query_id=%s parameters=%d max_rows=%d",
        database_type,
        query.id,
        len(values),
        row_limit,
    )
    if database_type == "postgresql":
        columns, rows, truncated = _execute_postgresql(
            query, compiled_sql, values, row_limit, current
        )
    else:
        columns, rows, truncated = _execute_db2(
            query, compiled_sql, values, row_limit, current
        )
    logger.info(
        "Approved database query completed: database=%s query_id=%s rows=%d truncated=%s",
        database_type,
        query.id,
        len(rows),
        truncated,
    )
    return {
        "queryId": query.id,
        "databaseType": database_type,
        "status": "ok",
        "description": query.result_description or query.description,
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "truncated": truncated,
    }

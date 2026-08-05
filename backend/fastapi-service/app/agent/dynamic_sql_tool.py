"""管理员专用的受限动态 SQL Tool。

模型只负责生成候选查询；本模块使用 SQL AST、表列白名单、函数白名单和
PostgreSQL 只读事务建立不可绕过的执行边界。
"""

import hashlib
import logging
from typing import Any

import psycopg
from sqlglot import exp, parse
from sqlglot.errors import ParseError

from app.agent.database_tool import _json_value
from app.config.settings import Settings, get_settings

logger = logging.getLogger(__name__)


class DynamicSqlToolError(RuntimeError):
    """可以安全返回给 Agent 的动态 SQL 校验或执行错误。"""


# 仅向管理员动态查询开放平台运维所需的最小字段；回答正文、对象存储 Key、
# 密码哈希等敏感或大文本字段不会提供给 Planner。
_PLATFORM_SCHEMA: dict[str, dict[str, str]] = {
    "ai_tasks": {
        "id": "任务 ID",
        "prompt": "用户提交的任务内容",
        "status": "任务状态",
        "model_provider": "模型供应商",
        "model_name": "实际模型名称",
        "database_type": "任务选择的数据源类型",
        "created_by": "创建用户 ID，可关联 app_users.id",
        "conversation_id": "所属会话 ID",
        "created_at": "任务创建时间",
        "updated_at": "任务更新时间",
    },
    "app_users": {
        "id": "用户 ID",
        "username": "登录用户名",
        "display_name": "用户显示名称",
        "role_id": "角色 ID，可关联 auth_roles.id",
        "is_active": "账号是否启用",
        "last_login_at": "最近登录时间",
        "created_at": "账号创建时间",
        "updated_at": "账号更新时间",
    },
    "auth_roles": {
        "id": "角色 ID",
        "code": "稳定角色编码",
        "name": "角色名称",
    },
}
_SENSITIVE_COLUMNS = {"password_hash", "username_normalized", "token_version"}
_SAFE_FUNCTIONS = {
    "AVG",
    "BOOL_AND",
    "BOOL_OR",
    "CAST",
    "COALESCE",
    "CONCAT",
    "COUNT",
    "CURRENT_DATE",
    "CURRENT_TIMESTAMP",
    "DATE_TRUNC",
    "EXTRACT",
    "LOWER",
    "MAX",
    "MIN",
    "NULLIF",
    "SUM",
    "UPPER",
}
_BLOCKED_NODE_KEYS = {
    "alter",
    "command",
    "copy",
    "create",
    "delete",
    "drop",
    "grant",
    "insert",
    "into",
    "lock",
    "merge",
    "revoke",
    "transaction",
    "update",
}


def planner_schema() -> dict[str, object]:
    """返回可以交给管理员 Planner 的非敏感平台运维数据字典。"""

    return {
        "database": "postgresql",
        "rules": [
            "只能生成一条 SELECT 或 WITH 查询",
            "所有真实表必须显式使用 public schema",
            "禁止 SELECT *，请明确列名",
            "禁止访问任何未列出的表、列和函数",
        ],
        "tables": [
            {
                "schema": "public",
                "name": table,
                "columns": [
                    {"name": name, "description": description}
                    for name, description in columns.items()
                ],
            }
            for table, columns in _PLATFORM_SCHEMA.items()
        ],
        "relationships": [
            "public.app_users.role_id = public.auth_roles.id",
            "public.ai_tasks.created_by = public.app_users.id",
        ],
    }


def _is_output_alias_reference(column: exp.Column) -> bool:
    """仅允许在所属 SELECT 的排序、分组等结果子句中引用输出别名。"""

    current = column.parent
    is_result_clause = False
    while current is not None and not isinstance(current, exp.Select):
        if current.key in {"order", "group", "having", "qualify"}:
            is_result_clause = True
        current = current.parent
    if not is_result_clause or not isinstance(current, exp.Select):
        return False
    aliases = {
        projection.alias.lower()
        for projection in current.expressions
        if projection.alias
    }
    return column.name.lower() in aliases


def validate_dynamic_sql(sql: str) -> tuple[str, list[str]]:
    """解析并校验候选 SQL，返回 PostgreSQL 规范化文本和真实表清单。"""

    candidate = sql.strip()
    if not candidate or len(candidate) > 8000:
        raise DynamicSqlToolError("动态 SQL 为空或超过长度限制")
    try:
        statements = parse(candidate, read="postgres")
    except ParseError as error:
        raise DynamicSqlToolError("动态 SQL 语法无法解析") from error
    if len(statements) != 1:
        raise DynamicSqlToolError("动态 SQL 必须且只能包含一条语句")
    tree = statements[0]
    if tree.key not in {"select", "union", "intersect", "except"}:
        raise DynamicSqlToolError("动态 SQL 只能是 SELECT/WITH 查询")
    for node in tree.walk():
        if node.key in _BLOCKED_NODE_KEYS:
            raise DynamicSqlToolError(f"动态 SQL 包含禁止节点：{node.key}")
    for with_clause in tree.find_all(exp.With):
        if with_clause.args.get("recursive"):
            raise DynamicSqlToolError("动态 SQL 禁止递归 CTE")

    cte_names = {
        cte.alias_or_name.lower()
        for cte in tree.find_all(exp.CTE)
        if cte.alias_or_name
    }
    table_aliases: dict[str, str] = {}
    referenced_tables: list[str] = []
    for table in tree.find_all(exp.Table):
        name = table.name.lower()
        schema = table.db.lower() if table.db else ""
        catalog = table.catalog.lower() if table.catalog else ""
        if name in cte_names and not schema and not catalog:
            continue
        if catalog or schema != "public" or name not in _PLATFORM_SCHEMA:
            raise DynamicSqlToolError(
                f"动态 SQL 不允许访问表：{table.sql(dialect='postgres')}"
            )
        table_aliases[name] = name
        table_aliases[table.alias_or_name.lower()] = name
        referenced_tables.append(f"public.{name}")
    if not referenced_tables:
        raise DynamicSqlToolError("动态 SQL 必须查询已批准的平台运维表")
    if len(referenced_tables) > 4:
        raise DynamicSqlToolError("动态 SQL 引用的真实表次数过多")

    # SELECT * 可能绕过敏感列白名单；COUNT(*) 是唯一允许的星号用法。
    for star in tree.find_all(exp.Star):
        if not isinstance(star.parent, exp.Count):
            raise DynamicSqlToolError("动态 SQL 禁止 SELECT *，必须明确选择列")

    all_allowed_columns = {
        column for columns in _PLATFORM_SCHEMA.values() for column in columns
    }
    for column in tree.find_all(exp.Column):
        name = column.name.lower()
        qualifier = column.table.lower() if column.table else ""
        if name in _SENSITIVE_COLUMNS:
            raise DynamicSqlToolError(f"动态 SQL 禁止访问敏感列：{name}")
        if (
            not qualifier
            and _is_output_alias_reference(column)
        ):
            continue
        if qualifier in cte_names:
            # CTE 内部选择本身仍会逐列校验，外层只能引用其已生成字段。
            continue
        if qualifier:
            source_table = table_aliases.get(qualifier)
            if source_table is None or name not in _PLATFORM_SCHEMA[source_table]:
                raise DynamicSqlToolError(f"动态 SQL 不允许访问列：{qualifier}.{name}")
        elif name not in all_allowed_columns:
            raise DynamicSqlToolError(f"动态 SQL 不允许访问列：{name}")

    for function in tree.find_all(exp.Func):
        function_name = function.sql_name().upper()
        if function_name not in _SAFE_FUNCTIONS:
            raise DynamicSqlToolError(f"动态 SQL 不允许调用函数：{function_name}")

    normalized = tree.sql(dialect="postgres", comments=False)
    return normalized, sorted(set(referenced_tables))


def execute_dynamic_sql(
    sql: str,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """在只读事务中执行通过 AST 校验的动态 PostgreSQL 查询。"""

    current = settings or get_settings()
    if not current.dynamic_sql_enabled:
        raise DynamicSqlToolError("动态 SQL Tool 尚未启用")
    if not current.postgres_enabled:
        raise DynamicSqlToolError("PostgreSQL Tool 尚未启用")
    if current.postgres_password is None:
        raise DynamicSqlToolError("PostgreSQL Tool 未配置连接密码")

    normalized_sql, tables = validate_dynamic_sql(sql)
    row_limit = max(
        1,
        min(current.dynamic_sql_max_rows, current.postgres_max_rows, 1000),
    )
    timeout_ms = max(1000, min(current.postgres_query_timeout_seconds, 120) * 1000)
    fingerprint = hashlib.sha256(normalized_sql.encode("utf-8")).hexdigest()[:16]
    wrapped_sql = f"SELECT * FROM ({normalized_sql}) AS dynamic_result LIMIT %s"
    try:
        with (
            psycopg.connect(
                host=current.postgres_host,
                port=current.postgres_port,
                dbname=current.postgres_db,
                user=current.postgres_user,
                password=current.postgres_password.get_secret_value(),
                sslmode=current.postgres_sslmode,
                connect_timeout=5,
            ) as connection,
            connection.cursor() as cursor,
        ):
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute(
                "SELECT set_config('statement_timeout', %s, true)",
                (str(timeout_ms),),
            )
            cursor.execute(wrapped_sql, (row_limit + 1,))
            columns = [description.name for description in (cursor.description or [])]
            raw_rows = cursor.fetchall()
    except Exception as error:
        logger.warning(
            "Dynamic SQL execution failed: fingerprint=%s error_type=%s",
            fingerprint,
            type(error).__name__,
        )
        raise DynamicSqlToolError("动态 SQL 查询执行失败") from error

    truncated = len(raw_rows) > row_limit
    rows = [
        {columns[index]: _json_value(value) for index, value in enumerate(row)}
        for row in raw_rows[:row_limit]
    ]
    logger.info(
        "Dynamic SQL completed: fingerprint=%s tables=%s rows=%d truncated=%s",
        fingerprint,
        ",".join(tables),
        len(rows),
        truncated,
    )
    return {
        "tool": "dynamic_sql",
        "databaseType": "postgresql",
        "status": "ok",
        "queryFingerprint": fingerprint,
        "tables": tables,
        "columns": columns,
        "rows": rows,
        "truncated": truncated,
    }

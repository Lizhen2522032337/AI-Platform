"""把经过受控 SQL Tool 校验的平台数据确定性渲染为 Markdown。"""

from typing import Any

_COLUMN_LABELS = {
    "id": "用户 ID",
    "username": "用户名",
    "display_name": "显示名称",
    "role_id": "角色 ID",
    "role_code": "角色编码",
    "role_name": "角色名称",
    "is_active": "是否启用",
    "last_login_at": "最近登录时间",
    "created_at": "创建时间",
    "updated_at": "更新时间",
}
_HIDDEN_COLUMNS = {"password_hash", "username_normalized", "token_version"}


def _markdown_value(value: object) -> str:
    """转义表格控制字符，避免数据库文本破坏 Markdown 结构。"""

    if value is None:
        return "—"
    if isinstance(value, bool):
        return "是" if value else "否"
    return str(value).replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def render_platform_data_answer(observations: list[dict[str, Any]]) -> str:
    """从动态 SQL 成功结果生成稳定清单，不再让大模型重新判断证据是否存在。"""

    result = next(
        (
            item
            for item in reversed(observations)
            if item.get("tool") == "dynamic_sql" and item.get("status") == "ok"
        ),
        None,
    )
    if result is None:
        message = next(
            (
                str(item.get("message"))
                for item in reversed(observations)
                if item.get("tool") == "dynamic_sql" and item.get("message")
            ),
            "未获得有效的动态数据库查询结果。",
        )
        return f"## 平台数据查询\n\n查询未完成：{_markdown_value(message)}"

    raw_rows = result.get("rows")
    rows = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []
    raw_columns = result.get("columns")
    columns = (
        [
            column
            for column in raw_columns
            if isinstance(column, str) and column not in _HIDDEN_COLUMNS
        ]
        if isinstance(raw_columns, list)
        else []
    )
    if not columns and rows:
        columns = [column for column in rows[0] if column not in _HIDDEN_COLUMNS]

    if not rows:
        return "## 平台用户清单\n\n查询成功，当前没有符合条件的用户记录。"
    if not columns:
        return "## 平台用户清单\n\n查询成功，但结果没有可展示的非敏感字段。"

    lines = [
        "## 平台用户清单",
        "",
        f"本次查询返回 **{len(rows)}** 条用户记录。",
        "",
        "| " + " | ".join(_COLUMN_LABELS.get(column, column) for column in columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(_markdown_value(row.get(column)) for column in columns) + " |")
    if result.get("truncated"):
        lines.extend(["", "> 结果已达到安全行数上限，当前仅展示前面的记录。"])
    return "\n".join(lines)

"""Supervisor 与两个领域 Planner；复杂业务可继续增加专用 Planner。"""

import json
import logging
from typing import cast

from pydantic import ValidationError

from app.agent.catalog import QueryCatalog
from app.agent.dynamic_sql_tool import (
    DynamicSqlToolError,
    planner_schema,
    validate_dynamic_sql,
)
from app.agent.types import (
    AgentIntent,
    AgentPlan,
    DatabaseType,
    DynamicSqlQuery,
    ExportFormat,
)
from app.config.settings import Settings, get_settings
from app.llm import LlmProviderError, ModelProvider, complete_json

logger = logging.getLogger(__name__)
_REPORT_WORDS = ("报表", "报告", "统计", "趋势", "汇总", "导出", "日报", "周报", "月报")
_FILE_EXPORT_WORDS = (
    "导出",
    "下载",
    "excel",
    "xlsx",
    "word",
    "docx",
    "pdf",
    "csv",
    "文件",
    "文档",
    "报表",
    "报告",
)
_NOTIFY_WORDS = ("通知", "发送", "推送", "告警")
_PLATFORM_USER_WORDS = ("用户", "账号", "账户", "角色", "权限")
_PLATFORM_TASK_WORDS = ("任务",)
_PLATFORM_QUERY_WORDS = ("整理", "列出", "查询", "查看", "统计", "汇总", "筛选", "多少")
_DEFAULT_EXPORT_FORMATS: list[ExportFormat] = [
    "md",
    "docx",
    "pdf",
    "xlsx",
    "json",
    "csv",
]
_DEFAULT_PLATFORM_USERS_SQL = """
SELECT u.id, u.username, u.display_name, r.code AS role_code,
       r.name AS role_name, u.is_active, u.last_login_at,
       u.created_at, u.updated_at
FROM public.app_users AS u
JOIN public.auth_roles AS r ON r.id = u.role_id
ORDER BY u.id
""".strip()
_DEFAULT_PLATFORM_TASKS_SQL = """
SELECT t.id AS task_id, t.prompt, t.status, t.model_provider, t.model_name,
       t.database_type, u.username AS created_by_username, t.conversation_id,
       t.created_at, t.updated_at
FROM public.ai_tasks AS t
LEFT JOIN public.app_users AS u ON u.id = t.created_by
ORDER BY t.created_at DESC
""".strip()


def choose_intent(prompt: str) -> AgentIntent:
    """Supervisor 先做稳定的业务分流，避免每次多调用一次模型。"""

    if any(
        word in prompt for word in (*_PLATFORM_USER_WORDS, *_PLATFORM_TASK_WORDS)
    ) and any(word in prompt for word in _PLATFORM_QUERY_WORDS):
        return "platform_data_query"
    return (
        "report_generation"
        if any(word in prompt for word in _REPORT_WORDS)
        else "incident_analysis"
    )


def _history_text(messages: list[dict[str, str]]) -> str:
    """只给 Planner 最近对话，限制长度且不写入日志。"""

    parts = [
        f"{message['role']}: {message['content'][:1200]}" for message in messages[-8:]
    ]
    return "\n".join(parts)[-8000:]


def requested_export_formats(prompt: str) -> list[ExportFormat]:
    """确定性提取用户明确指定的文件格式，避免模型擅自扩大导出范围。"""

    text = prompt.lower()
    formats: list[ExportFormat] = []
    markers: tuple[tuple[ExportFormat, tuple[str, ...]], ...] = (
        ("xlsx", ("excel", "xlsx", "xls")),
        ("docx", ("word", "docx", "doc")),
        ("pdf", ("pdf",)),
        ("md", ("markdown", ".md")),
        ("json", ("json",)),
        ("csv", ("csv",)),
    )
    for export_format, aliases in markers:
        if any(alias in text for alias in aliases):
            formats.append(export_format)
    return formats


def _fallback_plan(intent: AgentIntent, prompt: str) -> AgentPlan:
    if intent == "platform_data_query":
        is_task_query = any(word in prompt for word in _PLATFORM_TASK_WORDS)
        return AgentPlan(
            intent=intent,
            objective=prompt[:1000],
            knowledge_query=prompt[:250],
            hypotheses=[],
            queries=[],
            report_required=False,
            report_title="平台任务查询" if is_task_query else "平台用户查询",
            notify=False,
        )
    return AgentPlan(
        intent=intent,
        objective=prompt[:1000],
        knowledge_query=prompt[:250],
        hypotheses=[],
        queries=[],
        report_required=intent == "report_generation",
        report_title="生产分析报告"
        if intent == "report_generation"
        else "生产问题分析",
        notify=False,
    )


def _system_prompt(
    intent: AgentIntent,
    database_type: DatabaseType,
    allow_dynamic_sql: bool,
) -> str:
    common = """
你是企业生产系统的受控 Planner。你的职责是规划取证步骤，不负责直接回答。
参数必须满足目录定义；信息不足时宁可不查询，并在 hypotheses 中说明缺失信息。
knowledge_query 必须把多轮对话中的指代改写为可独立检索企业知识库的中文问题，最多250字。
只返回一个 JSON 对象，不要 Markdown、解释或代码块。JSON 字段必须是：
intent, objective, knowledge_query, hypotheses, queries, dynamic_query,
report_required, report_title, export_formats, notify。export_formats 只能包含
md、docx、pdf、xlsx、json、csv；queries 每项包含 query_id, purpose, parameters。
""".strip()
    dialect = (
        "当前数据源是 PostgreSQL；只选择目录中带 PostgreSQL 方言的查询。"
        if database_type == "postgresql"
        else "当前数据源是 DB2；只选择目录中带 DB2 方言的查询。"
    )
    if allow_dynamic_sql and database_type == "postgresql":
        query_rule = """
你可以从 approved_queries 选择固定 query_id；如果固定查询不能回答用户问题，
可以设置一个 dynamic_query，其中只包含 purpose 和 sql。候选 SQL 必须严格遵守
dynamic_sql_schema，只能查询其中列出的平台运维表，必须显式列名和 schema。
不得访问敏感列，不得生成写入语句。若不需要动态查询，dynamic_query 必须为 null。
""".strip()
    else:
        query_rule = (
            "只能从 approved_queries 中选择 query_id，绝对不能生成 SQL、命令或虚构查询 ID；"
            "dynamic_query 必须为 null。"
        )
    if intent == "platform_data_query":
        return (
            common
            + f"\n{dialect}\n{query_rule}\n"
            + "当前 Planner 专门处理平台用户、账号和角色数据查询。"
            + "当 dynamic_sql_schema 可用时，必须生成 dynamic_query，不能返回 null；"
            + "查询只选择回答用户问题所需的非敏感列。"
        )
    if intent == "report_generation":
        return (
            common
            + f"\n{dialect}\n{query_rule}\n"
            + "当前 Planner 专门规划统计报表，report_required 必须为 true。"
        )
    return (
        common
        + f"\n{dialect}\n{query_rule}\n"
        + "当前 Planner 专门分析生产问题，围绕现象、时间窗、影响范围和候选原因规划取证。"
    )


async def create_plan(
    intent: AgentIntent,
    prompt: str,
    provider: str,
    messages: list[dict[str, str]],
    catalog: QueryCatalog,
    database_type: DatabaseType,
    settings: Settings | None = None,
    allow_dynamic_sql: bool = False,
) -> AgentPlan:
    """调用对应 Planner，并在执行前裁剪未知查询和超出上限的步骤。"""

    current = settings or get_settings()
    catalog_text = json.dumps(
        catalog.planner_summary(database_type), ensure_ascii=False
    )
    dynamic_schema = (
        planner_schema()
        if allow_dynamic_sql
        and database_type == "postgresql"
        and current.dynamic_sql_enabled
        and current.postgres_enabled
        else None
    )
    user_prompt = (
        f"当前请求：\n{prompt}\n\n最近对话：\n{_history_text(messages)}"
        f"\n\n当前数据库：{database_type}\n业务字典与批准查询：\n{catalog_text[:24000]}"
        f"\n\n动态 SQL 白名单：\n{json.dumps(dynamic_schema, ensure_ascii=False)[:12000]}"
    )
    try:
        raw = await complete_json(
            cast(ModelProvider, provider),
            _system_prompt(intent, database_type, dynamic_schema is not None),
            user_prompt,
        )
        plan = AgentPlan.model_validate(raw)
    except (LlmProviderError, ValidationError) as error:
        logger.warning(
            "Agent planner fallback used: intent=%s error_type=%s",
            intent,
            type(error).__name__,
        )
        plan = _fallback_plan(intent, prompt)

    allowed_ids = {
        query.id for query in catalog.queries if query.supports(database_type)
    }
    approved_queries = [
        query for query in plan.queries if query.query_id in allowed_ids
    ]
    rejected_count = len(plan.queries) - len(approved_queries)
    if rejected_count:
        logger.warning(
            "Agent planner queries rejected by catalog: intent=%s rejected=%d",
            intent,
            rejected_count,
        )
    plan.intent = intent
    plan.queries = approved_queries[: max(0, min(current.agent_max_queries, 20))]
    if dynamic_schema is None:
        plan.dynamic_query = None
    elif intent == "platform_data_query":
        if plan.dynamic_query is not None:
            try:
                validate_dynamic_sql(plan.dynamic_query.sql)
            except DynamicSqlToolError:
                logger.warning(
                    "Platform data planner returned invalid dynamic SQL; safe fallback used"
                )
                plan.dynamic_query = None
        if plan.dynamic_query is None:
            logger.warning(
                "Platform data planner omitted dynamic SQL; safe fallback used"
            )
            is_task_query = any(word in prompt for word in _PLATFORM_TASK_WORDS)
            plan.dynamic_query = DynamicSqlQuery(
                purpose=(
                    "查询当前平台任务清单"
                    if is_task_query
                    else "查询当前平台用户及其角色和状态"
                ),
                sql=(
                    _DEFAULT_PLATFORM_TASKS_SQL
                    if is_task_query
                    else _DEFAULT_PLATFORM_USERS_SQL
                ),
            )
    if intent == "report_generation" or any(
        word in prompt.lower() for word in _FILE_EXPORT_WORDS
    ):
        # 平台数据查询优先于报表意图分流；显式要求导出时仍必须生成产物。
        plan.report_required = True
    explicit_formats = requested_export_formats(prompt)
    if explicit_formats:
        # 用户明确指定格式时，确定性规则优先于模型，绝不额外生成其他文件。
        plan.export_formats = explicit_formats
    elif plan.report_required:
        plan.export_formats = plan.export_formats or list(_DEFAULT_EXPORT_FORMATS)
    else:
        plan.export_formats = []
    # 通知属于外部副作用：用户请求、服务开关和自动发送开关三者必须同时满足。
    explicitly_requested = any(word in prompt for word in _NOTIFY_WORDS)
    plan.notify = bool(
        plan.notify
        and explicitly_requested
        and current.notification_enabled
        and current.notification_auto_send
    )
    return plan

"""LangGraph Agent 图：分流 → 规划 → Dify取证 → 数据库取证 → 汇总上下文。"""

import asyncio
import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.agent.catalog import QueryCatalog, load_query_catalog
from app.agent.database_tool import DatabaseToolError, execute_catalog_query
from app.agent.dynamic_sql_tool import DynamicSqlToolError, execute_dynamic_sql
from app.agent.planners import choose_intent, create_plan
from app.agent.types import AgentPlan, AgentState, DatabaseType
from app.config.settings import get_settings
from app.dify import DifyKnowledgeError, retrieve_knowledge

logger = logging.getLogger(__name__)

TraceCallback = Callable[[dict[str, object]], None]


def _emit_trace(
    state: AgentState,
    step_id: str,
    title: str,
    status: str,
    *,
    detail: str = "",
    kind: str = "stage",
    tool_name: str | None = None,
    duration_ms: int | None = None,
) -> None:
    """发送不含敏感正文的结构化执行摘要。"""

    callback = state.get("trace_callback")
    if not callable(callback):
        return
    step: dict[str, object] = {
        "id": step_id,
        "title": title,
        "status": status,
        "kind": kind,
    }
    if detail:
        step["detail"] = detail[:500]
    if tool_name:
        step["toolName"] = tool_name
    if duration_ms is not None:
        step["durationMs"] = max(0, duration_ms)
    callback(step)


@dataclass(frozen=True)
class AgentPreparation:
    """图执行完成后交给最终回答模型和文件 Tool 的稳定结果。"""

    intent: str
    plan: AgentPlan
    context: str
    observations: list[dict[str, Any]]


def supervisor_node(state: AgentState) -> dict[str, object]:
    started = time.perf_counter()
    _emit_trace(state, "supervisor", "分析请求并选择处理路线", "running")
    intent = choose_intent(state["prompt"])
    logger.info("Agent supervisor routed: task_id=%s intent=%s", state["task_id"], intent)
    intent_label = "报表生成" if intent == "report_generation" else "生产问题分析"
    _emit_trace(
        state,
        "supervisor",
        "分析请求并选择处理路线",
        "completed",
        detail=f"已识别为：{intent_label}",
        duration_ms=round((time.perf_counter() - started) * 1000),
    )
    return {"intent": intent}


def route_planner(state: AgentState) -> str:
    return str(state["intent"])


async def _planner_node(state: AgentState) -> dict[str, object]:
    started = time.perf_counter()
    _emit_trace(state, "planner", "制定受控执行计划", "running")
    catalog = load_query_catalog()
    plan = await create_plan(
        state["intent"],
        state["prompt"],
        state["provider"],
        state["messages"],
        catalog,
        state["database_type"],
        allow_dynamic_sql=state.get("allow_dynamic_sql", False),
    )
    logger.info(
        "Agent plan ready: task_id=%s intent=%s queries=%d report=%s notify=%s",
        state["task_id"],
        plan.intent,
        len(plan.queries),
        plan.report_required,
        plan.notify,
    )
    output_label = "结构化报告" if plan.report_required else "分析结论"
    _emit_trace(
        state,
        "planner",
        "制定受控执行计划",
        "completed",
        detail=(
            f"计划输出{output_label}，选择 {len(plan.queries)} 个批准查询"
            + ("和 1 个动态 SQL 查询" if plan.dynamic_query else "")
        ),
        duration_ms=round((time.perf_counter() - started) * 1000),
    )
    return {"plan": plan.model_dump()}


async def incident_planner_node(state: AgentState) -> dict[str, object]:
    return await _planner_node(state)


async def report_planner_node(state: AgentState) -> dict[str, object]:
    return await _planner_node(state)


async def knowledge_tool_node(state: AgentState) -> dict[str, object]:
    plan = AgentPlan.model_validate(state["plan"])
    started = time.perf_counter()
    _emit_trace(
        state,
        "dify_knowledge",
        "检索企业知识库",
        "running",
        kind="tool",
        tool_name="dify_knowledge",
    )
    try:
        knowledge = await retrieve_knowledge(plan.knowledge_query)
        logger.info(
            "Agent Dify tool completed: task_id=%s enabled=%s hits=%d",
            state["task_id"],
            knowledge.enabled,
            knowledge.hit_count,
        )
        status = "completed" if knowledge.enabled else "skipped"
        detail = (
            f"已取得 {knowledge.hit_count} 个相关知识块"
            if knowledge.enabled
            else "Dify Knowledge 当前未启用"
        )
        _emit_trace(
            state,
            "dify_knowledge",
            "检索企业知识库",
            status,
            detail=detail,
            kind="tool",
            tool_name="dify_knowledge",
            duration_ms=round((time.perf_counter() - started) * 1000),
        )
        return {
            "knowledge_context": knowledge.context,
            "knowledge_hits": knowledge.hit_count,
        }
    except DifyKnowledgeError as error:
        logger.warning("Agent Dify tool failed: task_id=%s", state["task_id"])
        _emit_trace(
            state,
            "dify_knowledge",
            "检索企业知识库",
            "failed",
            detail=str(error),
            kind="tool",
            tool_name="dify_knowledge",
            duration_ms=round((time.perf_counter() - started) * 1000),
        )
        return {
            "knowledge_context": "",
            "knowledge_hits": 0,
            "observations": [
                {
                    "tool": "dify_knowledge",
                    "status": "error",
                    "message": str(error),
                }
            ],
        }


async def database_tool_node(state: AgentState) -> dict[str, object]:
    plan = AgentPlan.model_validate(state["plan"])
    catalog: QueryCatalog = load_query_catalog()
    observations = list(state.get("observations", []))
    if not plan.queries and plan.dynamic_query is None:
        _emit_trace(
            state,
            "database_queries",
            "查询业务数据库",
            "skipped",
            detail="执行计划未要求查询业务数据库",
            kind="tool",
            tool_name="database_query",
        )
    for index, request in enumerate(plan.queries):
        started = time.perf_counter()
        step_id = f"database_query:{index}:{request.query_id}"
        title = f"执行批准查询 {request.query_id}"
        _emit_trace(
            state,
            step_id,
            title,
            "running",
            detail=f"数据源：{state['database_type']}",
            kind="tool",
            tool_name="database_query",
        )
        query = catalog.query_by_id(request.query_id)
        if query is None:
            observations.append(
                {
                    "tool": "database_query",
                    "databaseType": state["database_type"],
                    "queryId": request.query_id,
                    "status": "rejected",
                    "message": "查询不在批准目录中",
                }
            )
            _emit_trace(
                state,
                step_id,
                title,
                "failed",
                detail="查询不在管理员批准目录中，已拒绝执行",
                kind="tool",
                tool_name="database_query",
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
            continue
        try:
            result = await asyncio.to_thread(
                execute_catalog_query,
                query,
                request.parameters,
                state["database_type"],
            )
            observations.append({"tool": "database_query", **result})
            row_count = len(result.get("rows", []))
            truncated = "，结果已截断" if result.get("truncated") else ""
            _emit_trace(
                state,
                step_id,
                title,
                "completed",
                detail=f"返回 {row_count} 行{truncated}",
                kind="tool",
                tool_name="database_query",
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
        except DatabaseToolError as error:
            observations.append(
                {
                    "tool": "database_query",
                    "databaseType": state["database_type"],
                    "queryId": request.query_id,
                    "status": "error",
                    "message": str(error),
                }
            )
            _emit_trace(
                state,
                step_id,
                title,
                "failed",
                detail=str(error),
                kind="tool",
                tool_name="database_query",
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
    if plan.dynamic_query is not None:
        started = time.perf_counter()
        _emit_trace(
            state,
            "dynamic_sql",
            "生成并执行平台用户查询",
            "running",
            detail="正在校验 PostgreSQL AST、表列白名单和只读边界",
            kind="tool",
            tool_name="dynamic_sql",
        )
        if not state.get("allow_dynamic_sql", False):
            message = "当前用户没有动态 SQL 权限"
            observations.append(
                {"tool": "dynamic_sql", "status": "rejected", "message": message}
            )
            _emit_trace(
                state,
                "dynamic_sql",
                "生成并执行平台用户查询",
                "failed",
                detail=message,
                kind="tool",
                tool_name="dynamic_sql",
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
        else:
            try:
                result = await asyncio.to_thread(
                    execute_dynamic_sql,
                    plan.dynamic_query.sql,
                )
                observations.append(result)
                row_count = len(result.get("rows", []))
                truncated = "，结果已截断" if result.get("truncated") else ""
                _emit_trace(
                    state,
                    "dynamic_sql",
                    "生成并执行平台用户查询",
                    "completed",
                    detail=f"AST 校验通过，返回 {row_count} 行{truncated}",
                    kind="tool",
                    tool_name="dynamic_sql",
                    duration_ms=round((time.perf_counter() - started) * 1000),
                )
            except DynamicSqlToolError as error:
                observations.append(
                    {
                        "tool": "dynamic_sql",
                        "status": "error",
                        "message": str(error),
                    }
                )
                _emit_trace(
                    state,
                    "dynamic_sql",
                    "生成并执行平台用户查询",
                    "failed",
                    detail=str(error),
                    kind="tool",
                    tool_name="dynamic_sql",
                    duration_ms=round((time.perf_counter() - started) * 1000),
                )
    return {"observations": observations}


def context_builder_node(state: AgentState) -> dict[str, object]:
    started = time.perf_counter()
    _emit_trace(state, "context_builder", "整理证据并约束回答范围", "running")
    settings = get_settings()
    plan = AgentPlan.model_validate(state["plan"])
    observations = state.get("observations", [])
    evidence = json.dumps(observations, ensure_ascii=False, default=str)
    evidence = evidence[: max(1000, min(settings.agent_max_evidence_chars, 100000))]
    report_instruction = (
        "请输出结构化Markdown报告，至少包含摘要、现象、数据证据、原因分析、"
        "风险、建议和待补充信息。所有结论区分事实、推断和未知。"
        if plan.report_required
        else "请给出问题分析结论，区分已验证事实、合理推断和仍需确认的信息。"
    )
    context = (
        "[Agent执行计划]\n"
        f"目标：{plan.objective}\n"
        f"候选原因：{json.dumps(plan.hypotheses, ensure_ascii=False)}\n"
        f"输出要求：{report_instruction}\n\n"
        "[Dify知识库证据]\n"
        f"{state.get('knowledge_context') or '未取得知识库证据。'}\n\n"
        f"[{state['database_type']}及工具证据]\n"
        f"{evidence or '本次没有执行数据库查询。'}\n\n"
        "只能依据以上证据和对话作答，不得虚构数据库记录、指标或已执行动作。"
    )
    _emit_trace(
        state,
        "context_builder",
        "整理证据并约束回答范围",
        "completed",
        detail=f"已整理 {len(observations)} 条工具观察结果",
        duration_ms=round((time.perf_counter() - started) * 1000),
    )
    return {"agent_context": context}


def build_agent_graph():
    """使用显式状态图固定安全边界；后续可增加领域 Planner 或人工审批节点。"""

    builder = StateGraph(AgentState)
    builder.add_node("supervisor", supervisor_node)
    builder.add_node("incident_analysis", incident_planner_node)
    builder.add_node("report_generation", report_planner_node)
    builder.add_node("dify_knowledge_tool", knowledge_tool_node)
    builder.add_node("database_query_tool", database_tool_node)
    builder.add_node("context_builder", context_builder_node)
    builder.add_edge(START, "supervisor")
    builder.add_conditional_edges(
        "supervisor",
        route_planner,
        {
            "incident_analysis": "incident_analysis",
            "report_generation": "report_generation",
        },
    )
    builder.add_edge("incident_analysis", "dify_knowledge_tool")
    builder.add_edge("report_generation", "dify_knowledge_tool")
    builder.add_edge("dify_knowledge_tool", "database_query_tool")
    builder.add_edge("database_query_tool", "context_builder")
    builder.add_edge("context_builder", END)
    return builder.compile()


agent_graph = build_agent_graph()


async def prepare_agent(
    task_id: int,
    prompt: str,
    provider: str,
    messages: list[dict[str, str]],
    database_type: DatabaseType = "postgresql",
    allow_dynamic_sql: bool = False,
    trace_callback: TraceCallback | None = None,
) -> AgentPreparation:
    """运行取证图；现有 Worker 仍只需调用原来的 FastAPI `/process`。"""

    result = await agent_graph.ainvoke(
        {
            "task_id": task_id,
            "prompt": prompt,
            "provider": provider,
            "database_type": database_type,
            "allow_dynamic_sql": allow_dynamic_sql,
            "messages": messages,
            "observations": [],
            "trace_callback": trace_callback,
        }
    )
    plan = AgentPlan.model_validate(result["plan"])
    return AgentPreparation(
        intent=str(result["intent"]),
        plan=plan,
        context=str(result["agent_context"]),
        observations=list(result.get("observations", [])),
    )

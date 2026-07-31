"""LangGraph Agent 图：分流 → 规划 → Dify取证 → 数据库取证 → 汇总上下文。"""

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.agent.catalog import QueryCatalog, load_query_catalog
from app.agent.database_tool import DatabaseToolError, execute_catalog_query
from app.agent.planners import choose_intent, create_plan
from app.agent.types import AgentPlan, AgentState, DatabaseType
from app.config.settings import get_settings
from app.dify import DifyKnowledgeError, retrieve_knowledge

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AgentPreparation:
    """图执行完成后交给最终回答模型和文件 Tool 的稳定结果。"""

    intent: str
    plan: AgentPlan
    context: str
    observations: list[dict[str, Any]]


def supervisor_node(state: AgentState) -> dict[str, object]:
    intent = choose_intent(state["prompt"])
    logger.info("Agent supervisor routed: task_id=%s intent=%s", state["task_id"], intent)
    return {"intent": intent}


def route_planner(state: AgentState) -> str:
    return str(state["intent"])


async def _planner_node(state: AgentState) -> dict[str, object]:
    catalog = load_query_catalog()
    plan = await create_plan(
        state["intent"],
        state["prompt"],
        state["provider"],
        state["messages"],
        catalog,
        state["database_type"],
    )
    logger.info(
        "Agent plan ready: task_id=%s intent=%s queries=%d report=%s notify=%s",
        state["task_id"],
        plan.intent,
        len(plan.queries),
        plan.report_required,
        plan.notify,
    )
    return {"plan": plan.model_dump()}


async def incident_planner_node(state: AgentState) -> dict[str, object]:
    return await _planner_node(state)


async def report_planner_node(state: AgentState) -> dict[str, object]:
    return await _planner_node(state)


async def knowledge_tool_node(state: AgentState) -> dict[str, object]:
    plan = AgentPlan.model_validate(state["plan"])
    try:
        knowledge = await retrieve_knowledge(plan.knowledge_query)
        logger.info(
            "Agent Dify tool completed: task_id=%s enabled=%s hits=%d",
            state["task_id"],
            knowledge.enabled,
            knowledge.hit_count,
        )
        return {
            "knowledge_context": knowledge.context,
            "knowledge_hits": knowledge.hit_count,
        }
    except DifyKnowledgeError as error:
        logger.warning("Agent Dify tool failed: task_id=%s", state["task_id"])
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
    for request in plan.queries:
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
            continue
        try:
            result = await asyncio.to_thread(
                execute_catalog_query,
                query,
                request.parameters,
                state["database_type"],
            )
            observations.append({"tool": "database_query", **result})
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
    return {"observations": observations}


def context_builder_node(state: AgentState) -> dict[str, object]:
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
) -> AgentPreparation:
    """运行取证图；现有 Worker 仍只需调用原来的 FastAPI `/process`。"""

    result = await agent_graph.ainvoke(
        {
            "task_id": task_id,
            "prompt": prompt,
            "provider": provider,
            "database_type": database_type,
            "messages": messages,
            "observations": [],
        }
    )
    plan = AgentPlan.model_validate(result["plan"])
    return AgentPreparation(
        intent=str(result["intent"]),
        plan=plan,
        context=str(result["agent_context"]),
        observations=list(result.get("observations", [])),
    )

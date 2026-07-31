"""Agent 状态、Planner 输出以及通用数据库查询目录的数据结构。"""

from typing import Any, Literal, TypedDict

from pydantic import BaseModel, Field

Scalar = str | int | float | bool | None
AgentIntent = Literal["incident_analysis", "report_generation"]
DatabaseType = Literal["postgresql", "db2"]


class PlannedQuery(BaseModel):
    """Planner 从管理员批准的查询目录中选择的一次查询。"""

    query_id: str = Field(min_length=1, max_length=100)
    purpose: str = Field(default="", max_length=500)
    parameters: dict[str, Scalar] = Field(default_factory=dict)


class AgentPlan(BaseModel):
    """LLM Planner 的结构化输出；执行前还会进行查询 ID 白名单校验。"""

    intent: AgentIntent
    objective: str = Field(min_length=1, max_length=1000)
    knowledge_query: str = Field(min_length=1, max_length=250)
    hypotheses: list[str] = Field(default_factory=list, max_length=8)
    queries: list[PlannedQuery] = Field(default_factory=list, max_length=12)
    report_required: bool = False
    report_title: str = Field(default="生产问题分析", max_length=200)
    notify: bool = False


class AgentState(TypedDict, total=False):
    """在 LangGraph 节点之间传递、可序列化的任务状态。"""

    task_id: int
    prompt: str
    provider: str
    database_type: DatabaseType
    messages: list[dict[str, str]]
    intent: AgentIntent
    plan: dict[str, Any]
    knowledge_context: str
    knowledge_hits: int
    observations: list[dict[str, Any]]
    agent_context: str

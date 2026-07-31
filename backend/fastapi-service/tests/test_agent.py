"""LangGraph Agent 的目录校验、安全边界和文件 Tool 测试。"""

import asyncio

import pytest

from app.agent import graph
from app.agent.catalog import CatalogQuery, QueryCatalog
from app.agent.database_tool import _prepare_sql
from app.agent.db2_tool import Db2ToolError, _assert_read_only_sql
from app.agent.report_tools import create_report_files
from app.agent.types import AgentPlan
from app.config.settings import Settings
from app.dify import KnowledgeResult


def settings(**overrides) -> Settings:
    values = {
        "minio_root_user": "test-user",
        "minio_root_password": "test-password",
        "deepseek_api_key": "test-deepseek-key",
        "qwen_api_key": "test-qwen-key",
        "qwen_base_url": "https://example.invalid/v1",
    }
    values.update(overrides)
    return Settings(**values)


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE PROD.STATE SET VALUE = 1",
        "SELECT * FROM PROD.STATE; DELETE FROM PROD.STATE",
        "CALL PROD.RESET_STATE()",
    ],
)
def test_db2_tool_rejects_non_read_only_sql(sql: str) -> None:
    with pytest.raises(Db2ToolError):
        _assert_read_only_sql(sql)


def test_db2_tool_accepts_select_and_with() -> None:
    _assert_read_only_sql("SELECT ID FROM PROD.STATE FETCH FIRST 10 ROWS ONLY")
    _assert_read_only_sql("WITH X AS (SELECT ID FROM PROD.STATE) SELECT ID FROM X")


def test_report_file_tool_creates_markdown_json_and_csv(monkeypatch) -> None:
    stored = []

    def fake_save_file(object_key, payload, content_type):
        stored.append((object_key, payload, content_type))
        return {"objectKey": object_key, "contentType": content_type, "size": len(payload)}

    monkeypatch.setattr("app.agent.report_tools.save_file", fake_save_file)
    artifacts = create_report_files(
        9,
        "停机分析",
        "## 摘要\n发现压力异常。",
        [
            {
                "tool": "db2_query",
                "queryId": "pressure_window",
                "status": "ok",
                "columns": ["TIME", "PRESSURE"],
                "rows": [{"TIME": "2026-07-30 10:00:00", "PRESSURE": 2.1}],
            }
        ],
        settings(report_files_enabled=True),
    )
    assert len(artifacts) == 3
    assert stored[0][0] == "tasks/9/report.md"
    assert stored[1][0] == "tasks/9/evidence.json"
    assert stored[2][0] == "tasks/9/pressure_window.csv"


def test_langgraph_routes_report_and_builds_evidence(monkeypatch) -> None:
    async def fake_create_plan(
        intent, prompt, provider, messages, catalog, database_type
    ):
        assert intent == "report_generation"
        assert database_type == "postgresql"
        return AgentPlan(
            intent=intent,
            objective=prompt,
            knowledge_query="生产日报指标",
            report_required=True,
            report_title="生产日报",
        )

    async def fake_retrieve(query):
        assert query == "生产日报指标"
        return KnowledgeResult(True, "[知识库 1]\n日报口径", 1)

    monkeypatch.setattr(graph, "create_plan", fake_create_plan)
    monkeypatch.setattr(graph, "retrieve_knowledge", fake_retrieve)
    monkeypatch.setattr(graph, "load_query_catalog", lambda: QueryCatalog())
    monkeypatch.setattr(graph, "get_settings", lambda: settings())

    prepared = asyncio.run(
        graph.prepare_agent(
            12,
            "生成今天的生产日报",
            "qwen",
            [{"role": "user", "content": "生成今天的生产日报"}],
        )
    )
    assert prepared.intent == "report_generation"
    assert prepared.plan.report_required is True
    assert "日报口径" in prepared.context


def test_catalog_query_model_allows_parameterized_select() -> None:
    query = CatalogQuery(
        id="production_window",
        description="查询时间窗内生产记录",
        sql="SELECT ID FROM PROD.RECORD WHERE CREATED_AT >= ?",
    )
    assert query.id == "production_window"
    assert query.supports("db2") is True
    assert query.supports("postgresql") is False


def test_catalog_selects_sql_for_requested_database_dialect() -> None:
    query = CatalogQuery(
        id="production_window",
        description="查询时间窗内生产记录",
        sql={
            "postgresql": "SELECT id FROM record WHERE created_at >= :start_time LIMIT 10",
            "db2": "SELECT id FROM record WHERE created_at >= :start_time FETCH FIRST 10 ROWS ONLY",
        },
        parameters=[
            {
                "name": "start_time",
                "description": "开始时间",
                "type": "string",
            }
        ],
    )
    assert "LIMIT 10" in (query.sql_for("postgresql") or "")
    assert "FETCH FIRST 10" in (query.sql_for("db2") or "")

    postgresql_sql, postgresql_values = _prepare_sql(
        query.sql_for("postgresql") or "",
        "postgresql",
        query.parameters,
        {"start_time": "2026-07-31T00:00:00+08:00"},
    )
    db2_sql, db2_values = _prepare_sql(
        query.sql_for("db2") or "",
        "db2",
        query.parameters,
        {"start_time": "2026-07-31T00:00:00+08:00"},
    )
    assert "%s" in postgresql_sql
    assert "?" in db2_sql
    assert postgresql_values == db2_values

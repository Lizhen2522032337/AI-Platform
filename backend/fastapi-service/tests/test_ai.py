"""FastAPI AI 服务接口测试。"""

import json
from types import SimpleNamespace

from app import main
from app.agent.graph import AgentPreparation
from app.agent.types import AgentPlan
from fastapi.testclient import TestClient

client = TestClient(main.app)


def test_root_returns_service_role() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["role"] == "ai-service"


def test_health_checks_integrations(monkeypatch) -> None:
    monkeypatch.setattr(main, "check_integrations", lambda: None)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["dependencies"] == {"qdrant": "ok", "minio": "ok"}


def test_process_streams_and_saves_ai_result(monkeypatch) -> None:
    async def fake_prepare(
        task_id,
        prompt,
        provider,
        messages,
        database_type,
        allow_dynamic_sql,
        trace_callback,
    ):
        assert (task_id, prompt, provider) == (7, "测试任务", "qwen")
        assert database_type == "postgresql"
        assert allow_dynamic_sql is True
        assert messages[-1] == {"role": "user", "content": "测试任务"}
        trace_callback(
            {
                "id": "planner",
                "title": "制定受控执行计划",
                "status": "completed",
                "kind": "stage",
            }
        )
        return AgentPreparation(
            intent="incident_analysis",
            plan=AgentPlan(
                intent="incident_analysis",
                objective="测试任务",
                knowledge_query="测试任务",
                report_required=False,
            ),
            context="[知识库 1]\n测试知识",
            observations=[],
        )

    async def fake_stream(provider, messages, knowledge_context):
        assert provider == "qwen"
        assert messages == [
            {"role": "user", "content": "你好"},
            {"role": "assistant", "content": "你好，有什么可以帮你？"},
            {"role": "user", "content": "测试任务"},
        ]
        assert knowledge_context == "[知识库 1]\n测试知识"
        yield {"type": "start", "provider": provider, "model": "qwen-test"}
        yield {"type": "delta", "text": "处理"}
        yield {"type": "delta", "text": "完成"}

    monkeypatch.setattr(main, "get_settings", lambda: SimpleNamespace(agent_enabled=True))
    monkeypatch.setattr(main, "prepare_agent", fake_prepare)
    monkeypatch.setattr(main, "stream_chat", fake_stream)
    monkeypatch.setattr(
        main,
        "save_result",
        lambda task_id, _prompt, answer, provider, model, _usage, artifacts, metadata, execution_trace: {
            "taskId": task_id,
            "text": answer,
            "provider": provider,
            "model": model,
            "vectorId": str(task_id),
            "objectKey": f"tasks/{task_id}/result.json",
            "artifacts": artifacts,
            "agent": metadata,
            "executionTrace": execution_trace,
        },
    )
    response = client.post(
        "/process",
        json={
            "taskId": 7,
            "prompt": "测试任务",
            "modelProvider": "qwen",
            "allowDynamicSql": True,
            "messages": [
                {"role": "user", "content": "你好"},
                {"role": "assistant", "content": "你好，有什么可以帮你？"},
                {"role": "user", "content": "测试任务"},
            ],
        },
    )
    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines()]
    assert any(event.get("step", {}).get("id") == "planner" for event in events)
    assert {"type": "delta", "text": "处理"} in events
    assert events[-1]["type"] == "complete"
    assert events[-1]["result"]["text"] == "处理完成"
    assert events[-1]["result"]["agent"]["intent"] == "incident_analysis"
    assert events[-1]["result"]["executionTrace"][-1]["id"] == "model_generation"


def test_platform_data_query_renders_rows_without_second_llm(monkeypatch) -> None:
    async def fake_prepare(
        task_id,
        prompt,
        provider,
        messages,
        database_type,
        allow_dynamic_sql,
        trace_callback,
    ):
        assert task_id == 8
        assert allow_dynamic_sql is True
        return AgentPreparation(
            intent="platform_data_query",
            plan=AgentPlan(
                intent="platform_data_query",
                objective=prompt,
                knowledge_query="平台用户",
            ),
            context="包含两行平台用户证据",
            observations=[
                {
                    "tool": "dynamic_sql",
                    "status": "ok",
                    "columns": ["username", "display_name", "role_code", "is_active"],
                    "rows": [
                        {
                            "username": "admin",
                            "display_name": "系统管理员",
                            "role_code": "admin",
                            "is_active": True,
                        },
                        {
                            "username": "operator",
                            "display_name": "操作员",
                            "role_code": "user",
                            "is_active": False,
                        },
                    ],
                    "truncated": False,
                }
            ],
        )

    async def forbidden_stream_chat(*_args, **_kwargs):
        raise AssertionError("平台数据查询不应再次调用大模型")
        yield  # pragma: no cover

    monkeypatch.setattr(main, "get_settings", lambda: SimpleNamespace(agent_enabled=True))
    monkeypatch.setattr(main, "prepare_agent", fake_prepare)
    monkeypatch.setattr(main, "stream_chat", forbidden_stream_chat)
    monkeypatch.setattr(
        main,
        "save_result",
        lambda task_id, _prompt, answer, provider, model, _usage, artifacts, metadata, execution_trace: {
            "taskId": task_id,
            "text": answer,
            "provider": provider,
            "model": model,
            "artifacts": artifacts,
            "agent": metadata,
            "executionTrace": execution_trace,
        },
    )

    response = client.post(
        "/process",
        json={
            "taskId": 8,
            "prompt": "整理当前所有用户",
            "modelProvider": "deepseek",
            "databaseType": "postgresql",
            "allowDynamicSql": True,
            "messages": [{"role": "user", "content": "整理当前所有用户"}],
        },
    )

    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines()]
    complete = events[-1]["result"]
    assert complete["model"] == "platform-data-renderer"
    assert "本次查询返回 **2** 条用户记录" in complete["text"]
    assert "| admin | 系统管理员 | admin | 是 |" in complete["text"]
    assert "| operator | 操作员 | user | 否 |" in complete["text"]
    generation = next(
        event["step"]
        for event in events
        if event.get("type") == "trace"
        and event.get("step", {}).get("id") == "model_generation"
        and event.get("step", {}).get("status") == "completed"
    )
    assert generation["toolName"] == "platform_data_renderer"


def test_process_rejects_blank_prompt() -> None:
    response = client.post(
        "/process",
        json={
            "taskId": 1,
            "prompt": "",
            "modelProvider": "deepseek",
            "messages": [{"role": "user", "content": ""}],
        },
    )
    assert response.status_code == 422


def test_delete_task_artifacts(monkeypatch) -> None:
    captured = []
    monkeypatch.setattr(main, "delete_results", lambda tasks: captured.extend(tasks))

    response = client.request(
        "DELETE",
        "/artifacts/tasks",
        json={
            "tasks": [
                {"taskId": 7, "objectKey": "tasks/7/result.json"},
                {"taskId": 8, "objectKey": None},
            ]
        },
    )

    assert response.status_code == 204
    assert response.content == b""
    assert captured == [(7, "tasks/7/result.json"), (8, None)]


def test_download_task_artifact_returns_private_file(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "read_file",
        lambda object_key: (
            b"workbook-bytes",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
    )

    response = client.post(
        "/artifacts/download",
        json={"taskId": 7, "objectKey": "tasks/7/report.xlsx"},
    )

    assert response.status_code == 200
    assert response.content == b"workbook-bytes"
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


def test_download_task_artifact_rejects_cross_task_key() -> None:
    response = client.post(
        "/artifacts/download",
        json={"taskId": 7, "objectKey": "tasks/8/report.xlsx"},
    )

    assert response.status_code == 422

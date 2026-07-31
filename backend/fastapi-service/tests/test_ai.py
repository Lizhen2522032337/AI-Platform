"""FastAPI AI 服务接口测试。"""

import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import main
from app.agent.graph import AgentPreparation
from app.agent.types import AgentPlan

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
    async def fake_prepare(task_id, prompt, provider, messages, database_type):
        assert (task_id, prompt, provider) == (7, "测试任务", "qwen")
        assert database_type == "postgresql"
        assert messages[-1] == {"role": "user", "content": "测试任务"}
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
        lambda task_id, _prompt, answer, provider, model, _usage, artifacts, metadata: {
            "taskId": task_id,
            "text": answer,
            "provider": provider,
            "model": model,
            "vectorId": str(task_id),
            "objectKey": f"tasks/{task_id}/result.json",
            "artifacts": artifacts,
            "agent": metadata,
        },
    )
    response = client.post(
        "/process",
        json={
            "taskId": 7,
            "prompt": "测试任务",
            "modelProvider": "qwen",
            "messages": [
                {"role": "user", "content": "你好"},
                {"role": "assistant", "content": "你好，有什么可以帮你？"},
                {"role": "user", "content": "测试任务"},
            ],
        },
    )
    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[1] == {"type": "delta", "text": "处理"}
    assert events[-1]["type"] == "complete"
    assert events[-1]["result"]["text"] == "处理完成"
    assert events[-1]["result"]["agent"]["intent"] == "incident_analysis"


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

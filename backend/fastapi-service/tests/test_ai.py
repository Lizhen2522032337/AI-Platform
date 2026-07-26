"""FastAPI AI 服务接口测试。"""

from fastapi.testclient import TestClient

from app import main


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


def test_process_returns_ai_result(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "process_prompt",
        lambda task_id, prompt: {
            "taskId": task_id,
            "text": f"processed: {prompt}",
            "vectorId": str(task_id),
            "objectKey": f"tasks/{task_id}/result.json",
        },
    )
    response = client.post("/process", json={"taskId": 7, "prompt": "测试任务"})
    assert response.status_code == 200
    assert response.json()["vectorId"] == "7"


def test_process_rejects_blank_prompt() -> None:
    response = client.post("/process", json={"taskId": 1, "prompt": ""})
    assert response.status_code == 422

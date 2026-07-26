"""Worker 消息处理单元测试。"""

import json

from app import main


def test_process_message_updates_processing_and_completed(monkeypatch) -> None:
    database_updates: list[tuple[int, str]] = []
    redis_updates: list[dict] = []

    monkeypatch.setattr(
        main,
        "update_task",
        lambda task_id, status, **_: database_updates.append((task_id, status)),
    )
    monkeypatch.setattr(
        main,
        "save_state",
        lambda _task_id, state: redis_updates.append(state),
    )
    monkeypatch.setattr(
        main,
        "call_ai_service",
        lambda task_id, _prompt: {
            "taskId": task_id,
            "text": "完成",
            "vectorId": str(task_id),
            "objectKey": f"tasks/{task_id}/result.json",
        },
    )

    main.process_message(json.dumps({"id": 9, "prompt": "测试"}).encode())

    assert database_updates == [(9, "processing"), (9, "completed")]
    assert redis_updates[0]["status"] == "processing"
    assert redis_updates[-1]["status"] == "completed"

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
        "stream_ai_service",
        lambda task_id, _prompt, provider: iter(
            [
                {"type": "start", "provider": provider, "model": "test-model"},
                {"type": "delta", "text": "完"},
                {"type": "delta", "text": "成"},
                {
                    "type": "complete",
                    "result": {
                        "taskId": task_id,
                        "text": "完成",
                        "provider": provider,
                        "model": "test-model",
                        "vectorId": str(task_id),
                        "objectKey": f"tasks/{task_id}/result.json",
                    },
                },
            ]
        ),
    )

    main.process_message(
        json.dumps(
            {
                "id": 9,
                "ownerId": 3,
                "prompt": "测试",
                "modelProvider": "qwen",
            }
        ).encode()
    )

    assert database_updates == [(9, "processing"), (9, "completed")]
    assert redis_updates[0]["status"] == "processing"
    assert redis_updates[0]["ownerId"] == 3
    assert redis_updates[0]["modelProvider"] == "qwen"
    assert any(state.get("partialText") for state in redis_updates)
    assert redis_updates[-1]["status"] == "completed"
    assert redis_updates[-1]["ownerId"] == 3

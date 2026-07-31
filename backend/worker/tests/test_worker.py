"""Worker 消息处理单元测试。"""

import json

from app import main


def test_load_conversation_messages_keeps_chronological_context(monkeypatch) -> None:
    class FakeResult:
        def fetchall(self):
            return [("第一问", "第一答"), ("第二问", "第二答")]

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, _query, parameters):
            assert parameters == (8, 12, 10)
            return FakeResult()

    monkeypatch.setattr(main, "postgres_connection", lambda: FakeConnection())

    assert main.load_conversation_messages(8, 12, "第三问") == [
        {"role": "user", "content": "第一问"},
        {"role": "assistant", "content": "第一答"},
        {"role": "user", "content": "第二问"},
        {"role": "assistant", "content": "第二答"},
        {"role": "user", "content": "第三问"},
    ]


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
        "load_conversation_messages",
        lambda _conversation_id, _task_id, prompt: [
            {"role": "user", "content": "上一轮"},
            {"role": "assistant", "content": "上一轮回答"},
            {"role": "user", "content": prompt},
        ],
    )
    monkeypatch.setattr(
        main,
        "stream_ai_service",
        lambda task_id, _prompt, provider, database_type, messages: iter(
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
                "databaseType": "postgresql",
                "conversationId": 5,
            }
        ).encode()
    )

    assert database_updates == [(9, "processing"), (9, "completed")]
    assert redis_updates[0]["status"] == "processing"
    assert redis_updates[0]["ownerId"] == 3
    assert redis_updates[0]["modelProvider"] == "qwen"
    assert redis_updates[0]["databaseType"] == "postgresql"
    assert redis_updates[0]["conversationId"] == 5
    assert any(state.get("partialText") for state in redis_updates)
    assert redis_updates[-1]["status"] == "completed"
    assert redis_updates[-1]["ownerId"] == 3

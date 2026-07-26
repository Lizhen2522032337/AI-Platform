"""FastAPI CRUD 契约测试，不连接真实生产数据库。"""

import os
from datetime import UTC, datetime
from types import SimpleNamespace

os.environ.setdefault("POSTGRES_PASSWORD", "test-password")

from fastapi.testclient import TestClient

from app.database import get_db
from app.errors import APIError
from app.main import app
from app.routers import items as items_router


def fake_db():
    """提供不会访问数据库的测试依赖。"""

    yield object()


app.dependency_overrides[get_db] = fake_db
client = TestClient(app)


def sample_item(item_id: int = 1):
    now = datetime(2026, 7, 25, tzinfo=UTC)
    return SimpleNamespace(
        id=item_id,
        name="测试记录",
        description="测试说明",
        created_at=now,
        updated_at=now,
    )


def test_list_items(monkeypatch):
    monkeypatch.setattr(
        items_router.item_service,
        "list_items",
        lambda _: [sample_item()],
    )
    response = client.get("/items")
    assert response.status_code == 200
    assert response.json()[0]["name"] == "测试记录"
    assert "updatedAt" in response.json()[0]


def test_create_item_returns_201(monkeypatch):
    monkeypatch.setattr(
        items_router.item_service,
        "create_item",
        lambda _, __: sample_item(),
    )
    response = client.post(
        "/items",
        json={"name": " 测试记录 ", "description": "测试说明"},
    )
    assert response.status_code == 201
    assert response.json()["id"] == 1


def test_blank_name_returns_400():
    response = client.post("/items", json={"name": "   ", "description": ""})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_missing_item_returns_404(monkeypatch):
    def not_found(_, __):
        raise APIError(404, "NOT_FOUND", "item not found")

    monkeypatch.setattr(items_router.item_service, "get_item", not_found)
    response = client.get("/items/999")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_delete_returns_empty_204(monkeypatch):
    monkeypatch.setattr(
        items_router.item_service,
        "delete_item",
        lambda _, __: None,
    )
    response = client.delete("/items/1")
    assert response.status_code == 204
    assert response.content == b""

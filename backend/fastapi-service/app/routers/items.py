"""统一 CRUD 路由。"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.item import ItemPayload, ItemResponse
from app.services import item_service


router = APIRouter()
DatabaseSession = Annotated[Session, Depends(get_db)]


@router.get("/health")
def health(db: DatabaseSession) -> dict[str, str]:
    """检查服务和数据库连接。"""

    item_service.check_database(db)
    return {"status": "ok", "database": "ok"}


@router.get("/items", response_model=list[ItemResponse])
def list_all_items(db: DatabaseSession) -> list[ItemResponse]:
    """查询全部记录。"""

    return item_service.list_items(db)


@router.get("/items/{item_id}", response_model=ItemResponse)
def get_one_item(item_id: int, db: DatabaseSession) -> ItemResponse:
    """查询单条记录。"""

    return item_service.get_item(db, item_id)


@router.post("/items", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
def create_one_item(payload: ItemPayload, db: DatabaseSession) -> ItemResponse:
    """创建记录。"""

    return item_service.create_item(db, payload)


@router.put("/items/{item_id}", response_model=ItemResponse)
def update_one_item(
    item_id: int, payload: ItemPayload, db: DatabaseSession
) -> ItemResponse:
    """完整更新记录。"""

    return item_service.update_item(db, item_id, payload)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_one_item(item_id: int, db: DatabaseSession) -> Response:
    """删除记录并返回空响应。"""

    item_service.delete_item(db, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

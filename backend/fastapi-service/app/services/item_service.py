"""platform_items 的数据库操作。"""

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.errors import APIError
from app.models.item import Item
from app.schemas.item import ItemPayload


def check_database(db: Session) -> None:
    """验证数据库连接。"""

    db.execute(text("SELECT 1"))


def list_items(db: Session) -> list[Item]:
    """按 ID 倒序返回全部记录。"""

    return list(db.scalars(select(Item).order_by(Item.id.desc())).all())


def get_item(db: Session, item_id: int) -> Item:
    """查询记录，不存在时返回统一 404。"""

    item = db.get(Item, item_id)
    if item is None:
        raise APIError(404, "NOT_FOUND", "item not found")
    return item


def create_item(db: Session, payload: ItemPayload) -> Item:
    """创建记录。"""

    item = Item(name=payload.name, description=payload.description)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def update_item(db: Session, item_id: int, payload: ItemPayload) -> Item:
    """完整更新记录。"""

    item = get_item(db, item_id)
    item.name = payload.name
    item.description = payload.description
    item.updated_at = db.scalar(select(func.now()))
    db.commit()
    db.refresh(item)
    return item


def delete_item(db: Session, item_id: int) -> None:
    """删除记录。"""

    item = get_item(db, item_id)
    db.delete(item)
    db.commit()

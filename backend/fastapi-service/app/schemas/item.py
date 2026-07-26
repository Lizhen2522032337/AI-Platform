"""platform_items 的请求和响应结构。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ItemPayload(BaseModel):
    """创建和完整更新共用的输入模型。"""

    name: str = Field(max_length=120)
    description: str = Field(default="", max_length=2000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        """名称去除空白后不能为空。"""

        cleaned = value.strip()
        if not cleaned:
            raise ValueError("name must not be blank")
        return cleaned


class ItemResponse(BaseModel):
    """统一返回 camelCase 时间字段。"""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    name: str
    description: str
    created_at: datetime = Field(serialization_alias="createdAt")
    updated_at: datetime = Field(serialization_alias="updatedAt")

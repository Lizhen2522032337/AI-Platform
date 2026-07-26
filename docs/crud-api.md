# 统一 CRUD API 契约

FastAPI、Gin 和 NestJS 必须遵守同一套接口与 JSON 结构。三套服务共享 PostgreSQL 表 `platform_items`。

## 数据模型

```json
{
  "id": 1,
  "name": "示例条目",
  "description": "条目说明",
  "createdAt": "2026-07-25T00:00:00.000Z",
  "updatedAt": "2026-07-25T00:00:00.000Z"
}
```

字段规则：

- `name`：去除首尾空格后长度为 1～120。
- `description`：可为空，最大长度 2000。
- 时间字段统一返回 ISO 8601 字符串。
- 列表按照 `id` 倒序返回。

## 路由

| 方法 | 路径 | 成功状态码 | 说明 |
| --- | --- | ---: | --- |
| GET | `/health` | 200 | 检查服务与数据库连接 |
| GET | `/items` | 200 | 查询全部记录 |
| GET | `/items/:id` | 200 | 查询单条记录 |
| POST | `/items` | 201 | 创建记录 |
| PUT | `/items/:id` | 200 | 完整更新记录 |
| DELETE | `/items/:id` | 204 | 删除记录，不返回响应体 |

POST 与 PUT 请求体：

```json
{
  "name": "示例条目",
  "description": "条目说明"
}
```

错误响应统一为：

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "item not found"
  }
}
```

参数错误返回 400，记录不存在返回 404，未处理的服务器错误返回 500。响应不得包含数据库密码或完整连接字符串。

## Nginx 对外路径

- FastAPI：`/api/fastapi/items`
- Gin：`/api/gin/items`
- NestJS：`/api/nest/items`

Nginx 会移除服务前缀，再将请求转发到各后端的 `/items` 路由。

# 服务接口契约

## 1. 对外接口

外部用户只允许通过 Nginx 访问 NestJS 和 Gin。FastAPI、Worker 和所有基础设施不发布宿主机端口。

### 1.1 NestJS 核心业务 API

| 方法 | 对外路径 | 成功状态 | 说明 |
| --- | --- | ---: | --- |
| GET | `/api/health` | 200 | 检查 PostgreSQL、Redis、RabbitMQ、FastAPI |
| POST | `/api/auth/login` | 200 | 用户名密码登录，返回角色、权限和 1 小时 JWT |
| GET | `/api/auth/me` | 200 | 查询当前登录人 |
| POST | `/api/auth/logout` | 204 | 清除登录 Cookie |
| GET | `/api/tasks` | 200 | 管理员查全部，普通用户只查自己的最近 100 个任务 |
| GET | `/api/tasks/:id` | 200 | 按任务归属校验后查询指定任务 |
| POST | `/api/tasks` | 202 | 创建当前用户的任务并投递 RabbitMQ |
| GET | `/api/users` | 200 | 管理员查询用户 |
| POST | `/api/users` | 201 | 管理员创建用户 |
| PATCH | `/api/users/:id` | 200 | 管理员修改角色、状态或密码 |

登录请求：

```json
{
  "username": "admin",
  "password": "不会保存为明文的密码"
}
```

登录响应同时设置 `HttpOnly; SameSite=Strict` Cookie：

```json
{
  "accessToken": "eyJ...",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "user": {
    "id": 1,
    "username": "admin",
    "displayName": "系统管理员",
    "role": "admin",
    "permissions": ["tasks:create", "tasks:read:any", "users:manage", "users:read"]
  }
}
```

非浏览器客户端可使用 `Authorization: Bearer <accessToken>`。浏览器前端不持久化响应中的 token，而是使用 HttpOnly Cookie。

创建请求：

```json
{
  "prompt": "总结设备巡检记录并提取风险点"
}
```

任务响应：

```json
{
  "id": 12,
  "prompt": "总结设备巡检记录并提取风险点",
  "status": "queued",
  "result": null,
  "errorMessage": null,
  "objectKey": null,
  "vectorId": null,
  "createdById": 1,
  "createdAt": "2026-07-26T12:00:00.000Z",
  "updatedAt": "2026-07-26T12:00:00.000Z"
}
```

状态只能是：`queued`、`processing`、`completed`、`failed`。

### 1.2 Gin 实时接口

| 方法 | 对外路径 | 说明 |
| --- | --- | --- |
| GET | `/realtime/health` | 检查 Gin 和 Redis |
| GET | `/realtime/events/:id/current` | 获取 Redis 中的当前任务状态 |
| GET | `/realtime/events/:id` | 建立 SSE 长连接，状态结束后自动关闭 |

两个事件接口都必须携带有效 JWT，并根据 `ownerId` 校验任务归属；`/realtime/health` 保持公开供容器健康检查使用。

SSE 事件名为 `task`，数据示例：

```text
event: task
data: {"id":12,"status":"processing"}
```

## 2. Docker 内部接口

### 2.1 FastAPI AI 服务

| 方法 | 内部路径 | 说明 |
| --- | --- | --- |
| GET | `http://fastapi-service:8000/health` | 检查 Qdrant 和 MinIO |
| POST | `http://fastapi-service:8000/process` | 执行 AI 处理 |

请求：

```json
{
  "taskId": 12,
  "prompt": "总结设备巡检记录"
}
```

响应：

```json
{
  "taskId": 12,
  "text": "AI 服务已处理：总结设备巡检记录",
  "vectorId": "12",
  "objectKey": "tasks/12/result.json"
}
```

当前实现使用 SHA-256 生成固定 8 维演示向量，用于验证完整链路；接入真实 Embedding 或大模型时，只替换 FastAPI 的处理实现，不改变 NestJS、RabbitMQ、Worker 和前端契约。

### 2.2 RabbitMQ 消息

队列名由 `RABBITMQ_TASK_QUEUE` 配置，默认 `ai_tasks`。队列为 durable quorum queue，消息设为 persistent。

```json
{
  "id": 12,
  "ownerId": 1,
  "prompt": "总结设备巡检记录",
  "createdAt": "2026-07-26T12:00:00.000Z"
}
```

## 3. 错误格式

业务接口统一优先返回：

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "task not found"
  }
}
```

参数错误为 400，未登录或 token 过期为 401，权限不足为 403，资源不存在为 404，登录限流为 429，依赖不可用为 503，未处理错误为 500。响应和日志不得包含密码、JWT 密钥或其他基础设施凭据。

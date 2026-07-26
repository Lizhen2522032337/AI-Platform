# 服务接口契约

## 1. 对外接口

外部用户只允许通过 Nginx 访问 NestJS 和 Gin。FastAPI、Worker 和所有基础设施不发布宿主机端口。

### 1.1 NestJS 核心业务 API

| 方法 | 对外路径 | 成功状态 | 说明 |
| --- | --- | ---: | --- |
| GET | `/api/health` | 200 | 检查 PostgreSQL、Redis、RabbitMQ、FastAPI |
| GET | `/api/tasks` | 200 | 查询最近 100 个任务 |
| GET | `/api/tasks/:id` | 200 | 查询指定任务 |
| POST | `/api/tasks` | 202 | 创建任务并投递 RabbitMQ |

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

参数错误为 400，资源不存在为 404，依赖不可用为 503，未处理错误为 500。响应和日志不得包含数据库、中间件或对象存储密码。

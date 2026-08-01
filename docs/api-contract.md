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
| GET | `/api/conversations` | 200 | 查询当前用户最近 100 个会话 |
| POST | `/api/conversations` | 201 | 创建空会话 |
| GET | `/api/conversations/:id` | 200 | 查询会话及按时间排列的问答轮次 |
| POST | `/api/conversations/:id/messages` | 202 | 在会话内发送消息并创建异步回答任务 |
| DELETE | `/api/conversations/:id` | 204 | 删除本人单个会话、问答轮次及关联存储产物 |

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
  "prompt": "总结设备巡检记录并提取风险点",
  "modelProvider": "deepseek",
  "databaseType": "postgresql"
}
```

`modelProvider` 只能是 `deepseek` 或 `qwen`；`databaseType` 只能是 `postgresql` 或 `db2`。客户端不能提交 API Key、连接密码、接口地址或任意模型名；这些值由 FastAPI 的仓库外配置映射。

任务响应：

```json
{
  "id": 12,
  "prompt": "总结设备巡检记录并提取风险点",
  "status": "queued",
  "modelProvider": "deepseek",
  "databaseType": "postgresql",
  "modelName": null,
  "answer": null,
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

创建会话：

```json
{ "modelProvider": "deepseek", "databaseType": "postgresql" }
```

发送下一轮消息：

```json
{
  "content": "继续解释刚才提到的第二点",
  "modelProvider": "deepseek",
  "databaseType": "postgresql"
}
```

一个会话同一时间只允许一条消息处于 `queued/processing`；否则返回 409，避免第二轮在第一轮回答完成前丢失上下文。会话列表始终只返回当前登录人的数据，管理员用户管理功能不会自动展示其他人的私人会话。

删除会话同样只允许操作当前登录人自己的数据。若仍有 `queued/processing` 任务则返回 409；删除成功会清理 MinIO 结果、Qdrant 向量、Redis 实时状态，并由 PostgreSQL 外键级联删除全部问答轮次。该操作不可恢复。

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
data: {"id":12,"status":"processing","modelProvider":"deepseek","modelName":"deepseek-v4-flash","partialText":"正在生成的回答"}
```

## 2. Docker 内部接口

### 2.1 FastAPI AI 服务

FastAPI 在调用模型前运行 LangGraph Agent。Supervisor 选择故障分析或报表 Planner，Planner 将多轮指代改写为独立检索问题，并根据用户选择的 PostgreSQL/DB2 方言，从外部批准目录中选择查询。Agent 根据 `DIFY_ENABLED` 决定是否请求 Dify Knowledge API：

```text
POST {DIFY_BASE_URL}/datasets/{DIFY_DATASET_ID}/retrieve
Authorization: Bearer {DIFY_API_KEY}
```

请求包含 Planner 生成的独立知识检索问题。返回知识块按 `DIFY_SCORE_THRESHOLD`、`DIFY_TOP_K` 和
`DIFY_MAX_CONTEXT_CHARS` 过滤后注入系统提示词。Key、问题正文和知识块正文均不会写入日志。

| 方法 | 内部路径 | 说明 |
| --- | --- | --- |
| GET | `http://fastapi-service:8000/health` | 检查 Qdrant 和 MinIO |
| POST | `http://fastapi-service:8000/process` | 调用选定大模型并返回 NDJSON 增量流 |
| DELETE | `http://fastapi-service:8000/artifacts/tasks` | 供 NestJS 内部清理 Qdrant 与 MinIO 任务产物 |

请求：

```json
{
  "taskId": 12,
  "prompt": "总结设备巡检记录",
  "modelProvider": "deepseek",
  "databaseType": "postgresql",
  "messages": [
    { "role": "user", "content": "上一轮问题" },
    { "role": "assistant", "content": "上一轮回答" },
    { "role": "user", "content": "总结设备巡检记录" }
  ]
}
```

响应媒体类型为 `application/x-ndjson`，每行一个事件：

```text
{"type":"trace","step":{"id":"planner","title":"制定受控执行计划","status":"completed","kind":"stage","detail":"计划输出分析结论，选择 2 个批准查询","durationMs":842}}
{"type":"trace","step":{"id":"dify_knowledge","title":"检索企业知识库","status":"running","kind":"tool","toolName":"dify_knowledge"}}
{"type":"start","provider":"deepseek","model":"deepseek-v4-flash"}
{"type":"delta","text":"第一段"}
{"type":"delta","text":"第二段"}
{"type":"usage","usage":{"prompt_tokens":20,"completion_tokens":50,"total_tokens":70}}
{"type":"complete","result":{"taskId":12,"text":"第一段第二段","provider":"deepseek","model":"deepseek-v4-flash","vectorId":"12","objectKey":"tasks/12/result.json"}}
```

`trace` 是面向用户的可审计执行摘要，状态为 `running`、`completed`、`failed` 或 `skipped`。它可以包含阶段名、Tool 名、返回行数/知识块数和耗时，但禁止包含隐藏思维链、提示词全文、SQL、查询参数、数据库正文、密钥或供应商原始响应。

FastAPI 解析 DeepSeek/千问的 SSE，但不向浏览器暴露供应商 Key。Worker 读取 NDJSON 后把 `partialText` 和完整 `executionTrace` 写入 Redis，Gin 再向浏览器推送；任务完成或失败时，轨迹同时写入 PostgreSQL 的 `result.executionTrace`，刷新页面后仍可查看。报表任务会把 Markdown、证据 JSON 和数据库查询 CSV 写入 MinIO；任务的 `answer`、模型信息、数据库类型和结果元数据由 Worker 写入 PostgreSQL。当前 Qdrant 仍使用 SHA-256 生成固定 8 维演示向量，后续可单独接入真实 Embedding。

### 2.2 RabbitMQ 消息

队列名由 `RABBITMQ_TASK_QUEUE` 配置，默认 `ai_tasks`。队列为 durable quorum queue，消息设为 persistent。

```json
{
  "id": 12,
  "ownerId": 1,
  "prompt": "总结设备巡检记录",
  "modelProvider": "deepseek",
  "databaseType": "postgresql",
  "conversationId": 8,
  "createdAt": "2026-07-26T12:00:00.000Z"
}
```

Worker 根据 `conversationId` 从 PostgreSQL 读取最近 `AI_CONTEXT_TURNS` 轮已完成问答，并向 FastAPI 发送：

```json
{
  "taskId": 12,
  "prompt": "第二个问题",
  "modelProvider": "deepseek",
  "databaseType": "postgresql",
  "messages": [
    { "role": "user", "content": "第一个问题" },
    { "role": "assistant", "content": "第一个回答" },
    { "role": "user", "content": "第二个问题" }
  ]
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

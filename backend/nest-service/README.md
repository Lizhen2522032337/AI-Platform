# NestJS 核心业务后端

NestJS 是系统唯一核心业务入口，负责：

- 创建和查询 AI 任务。
- 把任务持久化到 PostgreSQL。
- 把持久化消息投递到 RabbitMQ quorum queue。
- 检查 Redis、RabbitMQ 和 FastAPI 依赖状态。

它不执行耗时 AI 处理；该工作由 Worker 和 FastAPI 完成。公开接口统一由 Nginx 映射到 `/api/`。

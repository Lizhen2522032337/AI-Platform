# 项目架构与目录规划

## 1. 目标架构

```text
浏览器
  |
React
  |
Nginx :80
  |------------------------------|
  | /api                         | /realtime
NestJS Backend                 Gin Realtime
  |        |                       |
  |        +--> FastAPI AI         +--> Redis
  |
  +--> PostgreSQL
  +--> Redis
  +--> RabbitMQ --> Worker --> FastAPI
                           |       |
                           |       +--> Qdrant
                           |       +--> MinIO
                           +--> PostgreSQL
                           +--> Redis
```

Gin 没有遗漏，也不再复制 NestJS 的 CRUD。它负责 SSE 实时状态，适合 Go 长连接并发模型；NestJS 是唯一核心业务入口；FastAPI 专注 Python AI 生态；Worker 隔离耗时任务。

## 2. 目录

```text
enterprise-ai-platform/
├── frontend/                       React 用户界面
├── backend/
│   ├── nest-service/
│   │   └── src/
│   │       ├── infrastructure/     RabbitMQ、Redis 客户端
│   │       └── tasks/              任务业务模块
│   ├── fastapi-service/
│   │   └── app/
│   │       ├── config/             AI 服务配置
│   │       ├── integrations.py     Qdrant、MinIO 集成
│   │       └── main.py             健康与 AI 处理接口
│   ├── gin-service/
│   │   └── internal/
│   │       ├── config/             Redis 配置
│   │       └── realtime/           SSE 实时状态
│   └── worker/
│       └── app/main.py             RabbitMQ 消费与任务编排
├── database/migrations/            幂等 PostgreSQL 迁移
├── deploy/
│   ├── docker-compose.yml          全部容器与依赖关系
│   ├── nginx/nginx.conf            唯一入口路由
│   ├── database.env.example        数据库配置模板
│   ├── platform.env.example        中间件配置模板
│   ├── deploy.env.example          部署行为模板
│   └── scripts/                    Linux 部署与更新脚本
└── docs/                            架构、接口、部署文档
```

## 3. 一次任务的完整流程

1. React 向 `POST /api/tasks` 提交 prompt。
2. Nginx 把请求转给 NestJS。
3. NestJS 在 PostgreSQL 创建 `queued` 任务。
4. NestJS 把持久化消息写入 RabbitMQ quorum queue。
5. Worker 确认收到任务，写入 `processing` 状态到 PostgreSQL 和 Redis。
6. Worker 调用 FastAPI `/process`。
7. FastAPI 写入 Qdrant 向量和 MinIO JSON 结果。
8. Worker 把结果写回 PostgreSQL，并把 `completed` 状态写入 Redis。
9. Gin 从 Redis 读取新状态，通过 SSE 推送给 React。

## 4. 数据和端口边界

- 宿主机只发布 Nginx 的 TCP 80。
- PostgreSQL、Redis、RabbitMQ、Qdrant、MinIO、NestJS、FastAPI、Gin、Worker 均只在 Compose 网络通信。
- PostgreSQL、Redis、RabbitMQ、Qdrant、MinIO 使用独立 Docker 具名卷。
- 真实配置全部位于 `/etc/enterprise-ai-platform`，不写入 Git。
- Docker Compose 更新应用时不得使用 `down -v`，避免删除数据卷。

## 5. 当前 AI 实现边界

本版本实现的是可运行的架构基线，不包含真实 LLM 密钥和厂商绑定。FastAPI 当前生成演示向量及结果文件，后续可以在不改变外部接口的情况下接入 DeepSeek、OpenAI、私有模型或本地 Embedding 服务。

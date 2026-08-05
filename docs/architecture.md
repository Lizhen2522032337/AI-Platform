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
NestJS Auth + Backend          Gin Auth + Realtime
  |        |                       |
  |        +--> FastAPI AI         +--> Redis
  |
  +--> PostgreSQL
  +--> Redis
  +--> PostgreSQL 会话历史
  +--> RabbitMQ --> Worker --> 读取最近对话 --> FastAPI --> Dify Knowledge
                                                        +--> DeepSeek / 通义千问
                           |       |
                           |       +--> Qdrant
                           |       +--> MinIO
                           +--> PostgreSQL
                           +--> Redis
```

Gin 没有遗漏，也不再复制 NestJS 的 CRUD。它负责验证共享 JWT、校验任务归属和提供 SSE 实时状态；NestJS 是唯一认证、权限和核心业务入口；FastAPI 专注 Python AI 生态；Worker 隔离耗时任务。

## 2. 目录

```text
enterprise-ai-platform/
├── frontend/                       React 用户界面
├── backend/
│   ├── nest-service/
│   │   └── src/
│   │       ├── auth/               JWT、Cookie、全局认证与权限 Guard
│   │       ├── infrastructure/     RabbitMQ、Redis 客户端
│   │       ├── tasks/              带用户归属的任务业务模块
│   │       └── users/              用户、角色和权限管理
│   ├── fastapi-service/
│   │   └── app/
│   │       ├── config/             AI 服务配置
│   │       ├── dify.py             Dify Knowledge API 安全检索
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

1. React 通过 NestJS 登录；浏览器得到一小时 HttpOnly JWT Cookie。
2. React 创建或选择一个会话，向 `POST /api/conversations/:id/messages` 提交消息。
3. NestJS 验证 JWT、会话归属和 `tasks:create` 权限，在 PostgreSQL 创建带 `created_by`、`conversation_id` 的 `queued` 任务。
4. NestJS 把持久化消息写入 RabbitMQ quorum queue。
5. Worker 确认收到任务，写入 `processing` 状态到 PostgreSQL 和 Redis。
6. Worker 从 PostgreSQL 读取该会话最近若干轮已完成问答，组装 `user/assistant` 消息历史，再调用 FastAPI `/process`。
7. FastAPI 的 LangGraph Supervisor 分流到故障分析 Planner 或报表 Planner；Planner 生成独立知识检索问题，并按前端选择的 PostgreSQL/DB2 方言选择批准查询 ID。
8. Agent 依次调用 Dify Knowledge Tool 和统一只读数据库 Tool，汇总带来源的事实、推断与未知信息。
9. FastAPI 把 Agent 证据作为受控参考资料，根据 `modelProvider` 调用 DeepSeek 或通义千问，并同时发送完整对话历史。
10. FastAPI 读取供应商 SSE 并向 Worker 输出统一 NDJSON 增量；Worker 节流写入 Redis。
11. Gin 验证 JWT、token 版本和 `ownerId`，每次状态变化都通过 SSE 把增量回答推给 React。
12. 报表任务严格按用户明确指定的格式生成文件；未指定时使用默认格式集合。文件写入
    MinIO 后，在任务结果中记录文件元数据，再发送 `complete` 事件。
13. Worker 把完整回答、供应商、实际模型和结果元数据写回 PostgreSQL，并写入 Redis `completed` 状态；下一轮会把本轮问答加入上下文。
14. React 通过 NestJS 的任务归属鉴权接口下载结果文件；MinIO 保持仅在 Compose 内网可见。

## 4. 数据和端口边界

- Nginx 向局域网发布 TCP 80；PostgreSQL 可选仅绑定宿主机 `127.0.0.1:5432` 供 SSH 隧道使用。
- Redis、RabbitMQ、Qdrant、MinIO、NestJS、FastAPI、Gin、Worker 均只在 Compose 网络通信。
- PostgreSQL、Redis、RabbitMQ、Qdrant、MinIO 使用独立 Docker 具名卷。
- 真实配置全部位于 `/etc/enterprise-ai-platform`，不写入 Git；API Key 位于 `llm.env`，PostgreSQL 密码位于 `database.env`，DB2 DSN 和通知 Webhook 位于 `agent.env`，仅注入需要它们的容器。
- Docker Compose 更新应用时不得使用 `down -v`，避免删除数据卷。

## 5. 当前 AI 实现边界

本版本通过 LangGraph 显式状态图编排 Planner、Dify、PostgreSQL/DB2、报表文件和通知 Tool，再通过 OpenAI 兼容 Chat Completions 接入 DeepSeek 和阿里云百炼通义千问。数据库 Tool 只允许外部查询目录中的只读参数化 SQL；详细边界和必备资料见 `docs/agent-architecture.md`。Qdrant 当前仍使用演示向量；真正的知识检索由 Dify 完成。

DeepSeek 和通义千问的 Chat Completions 接口本身不替本项目保存历史。平台以 `chat_conversations` 和 `ai_tasks` 持久化会话，每次最多加载 `AI_CONTEXT_TURNS` 轮完整问答，默认 10、最大 20，以控制 Token 成本。旧的单轮任务在 `004_add_chat_conversations.sql` 中自动转换为独立历史会话。

# Enterprise AI Platform

这是一个支持多轮对话的企业 AI 平台。NestJS 负责登录认证、角色权限、会话和核心业务；React 提供 ChatGPT 风格会话界面；每轮回答通过 RabbitMQ 交给 Worker；Worker 从 PostgreSQL 组装最近对话历史后调用 FastAPI；Gin 验证登录人和任务归属后通过 Redis 提供实时 SSE 增量回答。

```text
React -> Nginx -> NestJS -> RabbitMQ -> Worker -> FastAPI
                  |                     |          |
               PostgreSQL            Redis     Qdrant
                                             + MinIO

React -> Nginx -> Gin realtime -> Redis
```

## 服务职责

| 服务 | 职责 | 对外路径 |
| --- | --- | --- |
| React | 多轮聊天、会话侧栏和管理员界面 | `/` |
| Nginx | 唯一入口与反向代理 | `:80` |
| NestJS | 登录、RBAC、用户管理、会话与任务创建和查询 | `/api/` |
| Gin | JWT 与任务归属校验、SSE 实时状态 | `/realtime/` |
| FastAPI | 调用 DeepSeek/千问、统一流式输出、向量与结果文件 | 仅 Docker 内网 |
| Worker | 消费 RabbitMQ 并协调 AI 处理 | 仅 Docker 内网 |
| PostgreSQL | 持久化任务 | 仅 Docker 内网 |
| Redis | 实时状态缓存 | 仅 Docker 内网 |
| RabbitMQ | 持久化异步任务队列 | 仅 Docker 内网 |
| Qdrant | 向量存储 | 仅 Docker 内网 |
| MinIO | AI 结果文件 | 仅 Docker 内网 |

## 文档入口

- [项目架构与目录](docs/architecture.md)
- [接口契约](docs/api-contract.md)
- [登录认证与角色权限](docs/authentication-rbac.md)
- [首次手动部署与更新脚本](docs/deployment-scripts.md)

部署约束：Windows 家庭版不运行 Docker；所有镜像构建和容器运行均位于 Linux 虚拟机 `192.168.86.133`。真实配置固定保存在仓库外的 `/etc/enterprise-ai-platform`，大模型 Key 单独保存在 `llm.env` 且只注入 FastAPI。

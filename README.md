# Enterprise AI Platform

这是一个面向企业 AI 任务处理的容器化基础项目。React 只访问 NestJS 核心业务 API；耗时任务通过 RabbitMQ 交给 Worker；Worker 调用 FastAPI AI 服务；Gin 通过 Redis 提供实时 SSE 状态。

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
| React | 用户界面 | `/` |
| Nginx | 唯一入口与反向代理 | `:80` |
| NestJS | 核心业务、任务创建和查询 | `/api/` |
| Gin | SSE 实时任务状态 | `/realtime/` |
| FastAPI | AI 处理、向量与结果文件 | 仅 Docker 内网 |
| Worker | 消费 RabbitMQ 并协调 AI 处理 | 仅 Docker 内网 |
| PostgreSQL | 持久化任务 | 仅 Docker 内网 |
| Redis | 实时状态缓存 | 仅 Docker 内网 |
| RabbitMQ | 持久化异步任务队列 | 仅 Docker 内网 |
| Qdrant | 向量存储 | 仅 Docker 内网 |
| MinIO | AI 结果文件 | 仅 Docker 内网 |

## 文档入口

- [项目架构与目录](docs/architecture.md)
- [接口契约](docs/api-contract.md)
- [首次手动部署与更新脚本](docs/deployment-scripts.md)

部署约束：Windows 家庭版不运行 Docker；所有镜像构建和容器运行均位于 Linux 虚拟机 `192.168.86.133`。真实配置固定保存在仓库外的 `/etc/enterprise-ai-platform`。

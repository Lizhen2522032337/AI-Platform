# Enterprise AI Platform

一个由 React 前端与 FastAPI、Gin、NestJS 三个后端服务组成的容器化项目。

## 项目结构

```text
enterprise-ai-platform/
├── frontend/
├── backend/
│   ├── fastapi-service/
│   ├── gin-service/
│   └── nest-service/
├── deploy/
│   ├── docker-compose.yml
│   ├── nginx/
│   │   └── nginx.conf
│   └── scripts/
│       ├── first-deploy.sh
│       ├── pull-code.sh
│       └── update-*.sh
├── database/
│   └── migrations/
├── docs/
└── README.md
```

## 服务入口

部署完成后，通过 Nginx 的 80 端口统一访问：

| 路径 | 服务 |
| --- | --- |
| `/` | React 前端 |
| `/api/fastapi/` | FastAPI |
| `/api/gin/` | Gin |
| `/api/nest/` | NestJS |

页面顶部可以选择 FastAPI、Gin 或 NestJS。三套后端实现相同的 `/items` CRUD API，并共享 PostgreSQL 表 `platform_items`，因此切换后端后看到的是同一批数据。

## PostgreSQL 配置

复制环境变量模板，但不要提交真实配置：

```bash
cp deploy/.env.example deploy/.env
```

编辑 `deploy/.env`：

```text
POSTGRES_HOST=host.docker.internal
POSTGRES_PORT=5432
POSTGRES_DB=enterprise_ai_platform
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<实际密码>
POSTGRES_SSLMODE=disable
```

`deploy/.env` 已被 Git 忽略。真实密码不得写进 Dockerfile、Compose、源代码或提交记录。

数据库运行在 Linux Docker 宿主机时，Compose 会把 `host.docker.internal` 映射到宿主机网关。PostgreSQL 必须监听 Docker 可以访问的地址，并在 `pg_hba.conf` 中允许对应 Docker bridge 网段连接。

如果数据库尚未创建，可在虚拟机上执行：

```bash
sudo -u postgres createdb enterprise_ai_platform
sudo -u postgres psql -d enterprise_ai_platform \
  -f /opt/enterprise-ai-platform/database/migrations/001_create_platform_items.sql
```

迁移脚本只执行一次，三套后端均设置为不自动修改表结构。

## 使用 Docker Compose 启动

在项目根目录执行：

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

查看运行状态：

```bash
docker compose -f deploy/docker-compose.yml ps
```

停止服务：

```bash
docker compose -f deploy/docker-compose.yml down
```

## 手动部署到虚拟机

推荐使用仓库内的独立 Linux 脚本完成首次部署、单服务更新、验收和回滚，完整说明见 [`docs/deployment-scripts.md`](docs/deployment-scripts.md)。

脚本化首次部署（PR 合并后）：

```bash
curl -fsSL \
  https://raw.githubusercontent.com/Lizhen2522032337/AI-Platform/master/deploy/scripts/bootstrap-deploy.sh \
  -o /tmp/bootstrap-deploy.sh
chmod +x /tmp/bootstrap-deploy.sh
/tmp/bootstrap-deploy.sh master
```

日常更新时先拉取代码，再根据变更范围选择对应脚本：

```bash
cd /opt/enterprise-ai-platform
./deploy/scripts/pull-code.sh master
./deploy/scripts/update-frontend.sh
```

上例只更新前端。FastAPI、Gin、NestJS、Nginx、多服务、全量更新和回滚命令见完整脚本文档。

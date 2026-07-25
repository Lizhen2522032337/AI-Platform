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
│   └── nginx/
│       └── nginx.conf
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

生产虚拟机地址为 `192.168.86.133`。部署前请在虚拟机上安装 Docker Engine、Docker Compose 插件和 `tar`，并准备一个能够通过 SSH 登录且有权运行 Docker 的账号。

在本地项目根目录生成只包含 Git 已跟踪文件的部署包：

```bash
git archive --format=tar.gz --output=enterprise-ai-platform.tar.gz HEAD
```

将 `<vm-user>` 替换为虚拟机登录用户名，然后上传部署包：

```bash
scp enterprise-ai-platform.tar.gz <vm-user>@192.168.86.133:/tmp/
```

登录虚拟机并部署：

```bash
ssh <vm-user>@192.168.86.133
sudo mkdir -p /opt/enterprise-ai-platform
sudo tar -xzf /tmp/enterprise-ai-platform.tar.gz -C /opt/enterprise-ai-platform
cd /opt/enterprise-ai-platform
docker compose -f deploy/docker-compose.yml up -d --build --remove-orphans
docker compose -f deploy/docker-compose.yml ps
```

后续更新时，重新生成并上传部署包，再执行相同的解压和 Compose 命令即可。

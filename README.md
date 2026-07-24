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

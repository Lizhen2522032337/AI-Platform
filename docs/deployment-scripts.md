# 首次部署与独立更新手册

## 1. 固定部署约束

- Windows 家庭版宿主机不安装、不运行 Docker，只负责编辑代码、Git、SSH 和浏览器验收。
- Docker Engine、Docker Compose、镜像构建和容器运行全部位于 Linux 虚拟机 `192.168.86.133`。
- Git 仓库部署到 `/opt/enterprise-ai-platform`。
- 数据库连接配置独立保存在虚拟机 `/etc/enterprise-ai-platform/database.env`，不进入 Git 仓库。
- 当前部署分支为 `agent/initial-project`。合并到 `master` 后，只需修改 `/etc/enterprise-ai-platform/deploy.env` 中的 `DEPLOY_BRANCH`。

## 2. 首次部署前准备

### 2.1 从 Windows 登录虚拟机

```powershell
ssh <虚拟机用户名>@192.168.86.133
```

在虚拟机确认系统、资源和端口：

```bash
cat /etc/os-release
uname -m
free -h
df -h /
sudo ss -lntp | grep ':80 ' || true
```

建议至少 2 核 CPU、4 GB 内存和 10 GB 可用空间。

### 2.2 确认 Git、Docker Engine 和 Compose v2

```bash
git --version
docker --version
docker compose version
docker info
curl --version
```

若缺少 Docker，请按虚拟机发行版使用 Docker 官方仓库安装 Docker Engine、Buildx 和 Compose 插件：

- Ubuntu：<https://docs.docker.com/engine/install/ubuntu/>
- Debian：<https://docs.docker.com/engine/install/debian/>
- CentOS：<https://docs.docker.com/engine/install/centos/>
- RHEL：<https://docs.docker.com/engine/install/rhel/>

安装后启用服务，并允许当前可信运维用户执行 Docker：

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

退出 SSH 后重新登录，再验证：

```bash
docker info
docker compose version
docker run --rm hello-world
```

### 2.3 准备数据库连接文件

数据库已经由新环境中的独立 Docker 容器提供。应用首次部署脚本不会创建、启动、修改或迁移数据库。执行应用部署前，请确认：

1. 数据库容器已经运行，并通过主机端口或可达的 Docker 网络提供连接。
2. 目标数据库、用户、权限和 `platform_items` 表结构已经准备完成。
3. `/etc/enterprise-ai-platform/database.env` 已保存正确连接参数。

在虚拟机执行：

```bash
sudo install -d -m 700 -o "$USER" -g "$(id -gn)" /etc/enterprise-ai-platform
install -m 600 /dev/null /etc/enterprise-ai-platform/database.env
vi /etc/enterprise-ai-platform/database.env
```

连接文件示例：

```dotenv
POSTGRES_HOST=host.docker.internal
POSTGRES_PORT=5432
POSTGRES_DB=enterprise_ai_platform
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<实际密码>
POSTGRES_SSLMODE=disable
```

若数据库容器与应用容器不在同一个 Compose 网络中，最简单的方式是把数据库端口发布到虚拟机，并使用 `host.docker.internal` 连接。真实密码不得提交 Git。

## 3. 第一次完整部署

确认 `/opt/enterprise-ai-platform` 不存在或为空。然后在虚拟机普通 sudo 用户下执行：

```bash
curl -fsSL \
  https://raw.githubusercontent.com/Lizhen2522032337/AI-Platform/agent/initial-project/deploy/scripts/bootstrap-deploy.sh \
  -o /tmp/bootstrap-deploy.sh
chmod +x /tmp/bootstrap-deploy.sh
/tmp/bootstrap-deploy.sh agent/initial-project
```

脚本会依次：

1. 创建 `/opt/enterprise-ai-platform`。
2. 创建仓库外配置目录 `/etc/enterprise-ai-platform`。
3. 克隆指定 Git 分支。
4. 检查现有 `/etc/enterprise-ai-platform/database.env` 是否可读，但不修改它。
5. 构建前端、三套后端和 Nginx 所需镜像。
6. 启动应用容器并验收页面、健康接口和查询接口。

首次部署不会运行 `database/migrations/*.sql`。数据库结构必须在执行本节命令前准备完成。

首次部署完成后检查：

```bash
cd /opt/enterprise-ai-platform
docker compose -f deploy/docker-compose.yml ps
bash ./deploy/scripts/verify.sh
```

## 4. 后续独立更新脚本

以下脚本都会先检查工作区、从 Git 拉取 `/etc/enterprise-ai-platform/deploy.env` 中配置的分支，并使用 `git pull --ff-only`。仓库存在本地修改时会立即停止，不会覆盖文件。

```bash
cd /opt/enterprise-ai-platform
```

只更新前端：

```bash
bash ./deploy/scripts/update-frontend.sh
```

只更新 FastAPI：

```bash
bash ./deploy/scripts/update-fastapi.sh
```

只更新 Gin：

```bash
bash ./deploy/scripts/update-gin.sh
```

只更新 NestJS：

```bash
bash ./deploy/scripts/update-nest.sh
```

显式指定其他分支时，把分支名作为第一个参数：

```bash
bash ./deploy/scripts/update-frontend.sh master
```

公共 Compose、Dockerfile、迁移或多个基础配置变化时执行全量更新：

```bash
bash ./deploy/scripts/update-all.sh
```

同时更新多个组件：

```bash
bash ./deploy/scripts/update-services.sh frontend fastapi-service
bash ./deploy/scripts/update-services.sh --branch master gin-service nest-service
```

单组件脚本只构建并重建目标容器，不重建其他业务容器；三套后端更新前会先执行幂等数据库迁移。Nginx 会被快速重启一次，以刷新重建后容器的地址。

## 5. 更换数据库

先备份并修改仓库外配置：

```bash
cp /etc/enterprise-ai-platform/database.env \
  /etc/enterprise-ai-platform/database.env.bak.$(date +%Y%m%d%H%M%S)
vi /etc/enterprise-ai-platform/database.env
```

确认新数据库已经创建并授权后，执行：

```bash
cd /opt/enterprise-ai-platform
bash ./deploy/scripts/apply-database-config.sh
```

该脚本会在新数据库执行迁移，只重建三套后端并验收，不重建 React 前端。若失败，恢复备份配置后再次执行同一脚本。

## 6. 验收

虚拟机内：

```bash
bash /opt/enterprise-ai-platform/deploy/scripts/verify.sh
```

Windows PowerShell：

```powershell
Test-NetConnection 192.168.86.133 -Port 80
Invoke-WebRequest http://192.168.86.133/
Invoke-RestMethod http://192.168.86.133/api/fastapi/health
Invoke-RestMethod http://192.168.86.133/api/gin/health
Invoke-RestMethod http://192.168.86.133/api/nest/health
Invoke-RestMethod http://192.168.86.133/api/fastapi/items
Invoke-RestMethod http://192.168.86.133/api/gin/items
Invoke-RestMethod http://192.168.86.133/api/nest/items
```

## 7. 状态、日志和回滚

```bash
cd /opt/enterprise-ai-platform
docker compose -f deploy/docker-compose.yml ps -a
docker compose -f deploy/docker-compose.yml logs --tail=200
docker compose -f deploy/docker-compose.yml logs -f --tail=100 fastapi-service
```

更新脚本会把更新前提交记录到 `~/.local/state/enterprise-ai-platform/previous_commit`。回滚最近一次更新：

```bash
bash ./deploy/scripts/rollback.sh
```

或回滚到指定提交：

```bash
bash ./deploy/scripts/rollback.sh <commit-id>
```

回滚后处于 detached HEAD。修复完成后执行对应分支的全量更新脚本恢复。

## 8. 重要注意事项

- 不要删除 `/etc/enterprise-ai-platform`，除非确定不再需要当前数据库配置。
- 不要把 `database.env`、密码、令牌或私钥复制进仓库。
- 不要在 Windows 宿主机运行本文中的 Docker 命令。
- 更新脚本不会自动清理镜像或卷，避免误删数据库数据。
- 当前每个服务只有一个容器，重建期间会有短暂不可用。
- 数据库迁移必须保持向后兼容，否则代码回滚可能无法读取新结构。

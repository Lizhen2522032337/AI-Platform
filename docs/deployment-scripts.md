# Linux 部署与更新脚本

所有脚本都位于 `deploy/scripts`，可从任意目录执行。脚本使用 `set -Eeuo pipefail`，遇到命令失败会立即停止，不会静默继续。

## 1. 首次部署

### 1.1 一条引导脚本部署

在普通 sudo 用户下执行，不要先切换为 root。PR 合并到 `master` 后执行：

```bash
curl -fsSL \
  https://raw.githubusercontent.com/Lizhen2522032337/AI-Platform/master/deploy/scripts/bootstrap-deploy.sh \
  -o /tmp/bootstrap-deploy.sh
chmod +x /tmp/bootstrap-deploy.sh
/tmp/bootstrap-deploy.sh master
```

PR 尚未合并时，把下载地址和脚本参数中的分支都改为 `agent/initial-project`：

```bash
curl -fsSL \
  https://raw.githubusercontent.com/Lizhen2522032337/AI-Platform/agent/initial-project/deploy/scripts/bootstrap-deploy.sh \
  -o /tmp/bootstrap-deploy.sh
chmod +x /tmp/bootstrap-deploy.sh
/tmp/bootstrap-deploy.sh agent/initial-project
```

引导脚本会：

1. 创建 `/opt/enterprise-ai-platform` 并克隆指定分支。
2. 交互式读取 PostgreSQL 密码并创建权限为 `600` 的 `deploy/.env`。
3. 创建 `enterprise_ai_platform` 数据库（不存在时）。
4. 配置 PostgreSQL 监听地址、`pg_hba.conf` 和 Docker 私有网段防火墙规则。
5. 依次执行数据库迁移、镜像构建、容器启动和接口验收。

修改 `pg_hba.conf` 前，脚本会在同目录生成带时间戳的备份。要求虚拟机已安装 Git、Docker、Docker Compose v2、PostgreSQL 客户端、curl、sudo，并且 PostgreSQL 由 systemd 管理。

### 1.2 仓库已经克隆

```bash
cd /opt/enterprise-ai-platform
./deploy/scripts/first-deploy.sh
```

如果 `deploy/.env` 已存在，脚本会保留现有文件，不会覆盖密码。

## 2. 日常更新的固定顺序

先拉取代码，再根据变更文件执行一个更新脚本：

```bash
cd /opt/enterprise-ai-platform
./deploy/scripts/pull-code.sh master
```

PR 尚未合并时：

```bash
./deploy/scripts/pull-code.sh agent/initial-project
```

`pull-code.sh` 会：

- 检查工作区；只要存在本地修改就停止，绝不覆盖。
- 记录更新前 Commit 和生产分支到被 Git 忽略的 `deploy/.state`。
- 使用 `git pull --ff-only`，禁止隐式合并。
- 输出更新前后 Commit 以及变更文件列表。

## 3. 按变更范围执行

| 变更范围 | 执行命令 |
| --- | --- |
| 只修改 React | `./deploy/scripts/update-frontend.sh` |
| 只修改 FastAPI | `./deploy/scripts/update-fastapi.sh` |
| 只修改 Gin | `./deploy/scripts/update-gin.sh` |
| 只修改 NestJS | `./deploy/scripts/update-nest.sh` |
| 只修改 Nginx 配置 | `./deploy/scripts/update-nginx.sh` |
| Compose、Dockerfile、迁移或公共基础配置 | `./deploy/scripts/update-all.sh` |

同时修改多个应用服务时，把 Compose 服务名作为参数：

```bash
./deploy/scripts/update-services.sh frontend fastapi-service
```

允许的服务名：

- `frontend`
- `fastapi-service`
- `gin-service`
- `nest-service`
- `nginx`

后端和全量更新脚本会先按文件名顺序执行 `database/migrations/*.sql`。迁移文件必须设计成可重复执行。应用容器重建后，脚本会刷新 Nginx，避免 Nginx 保留旧容器地址而返回 502。

## 4. 单独验收

```bash
./deploy/scripts/verify.sh
```

该脚本检查容器状态，并轮询以下入口：

- React 页面
- 三个后端的 `/health`
- 三个后端的 `/items`

从 Windows 开发电脑进一步检查：

```powershell
Invoke-WebRequest http://192.168.86.133/
Invoke-RestMethod http://192.168.86.133/api/fastapi/health
Invoke-RestMethod http://192.168.86.133/api/gin/health
Invoke-RestMethod http://192.168.86.133/api/nest/health
Invoke-RestMethod http://192.168.86.133/api/fastapi/items
Invoke-RestMethod http://192.168.86.133/api/gin/items
Invoke-RestMethod http://192.168.86.133/api/nest/items
```

## 5. 更新失败时回滚

不传参数时，回滚到最近一次 `pull-code.sh` 记录的 Commit：

```bash
./deploy/scripts/rollback.sh
```

也可以明确指定 Commit：

```bash
./deploy/scripts/rollback.sh <commit-id>
```

回滚完成后仓库处于 detached HEAD。问题修复后恢复生产分支：

```bash
git switch master
git pull --ff-only origin master
./deploy/scripts/update-all.sh
```

PR 尚未合并时，将两条 Git 命令改为：

```bash
git switch agent/initial-project
git pull --ff-only origin agent/initial-project
./deploy/scripts/update-all.sh
```

之所以先直接使用 Git，是因为目标回滚提交可能早于这些部署脚本，回滚后 `pull-code.sh` 可能暂时不存在。

## 6. 注意事项

- 不要把 `deploy/.env` 上传或提交到 Git；脚本不会打印数据库密码。
- `docker compose config` 可能展开敏感环境变量，因此脚本统一使用 `config --quiet`。
- 当前每个服务只有一个容器，更新会产生短暂重启；后端或 Nginx 更新期间可能短暂返回 502。
- `update-*.sh` 只更新当前工作区代码，不会自动拉取 Git；必须先运行 `pull-code.sh`。
- 数据库结构变更需要兼容旧版本应用，避免回滚代码后无法读取新结构。

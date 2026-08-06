# Linux 虚拟机部署与更新手册

适用环境：Windows 家庭版开发机，Linux 虚拟机 `192.168.86.133` 已安装 Git、Docker Engine、Docker Compose v2。Windows 不运行 Docker。

第一次建议完整执行第 4 节的手动步骤；理解启动顺序并验收成功后，再使用第 5 节的一键脚本。

## 1. 固定路径和启动顺序

| 内容 | 固定位置 |
| --- | --- |
| Git 仓库 | `/opt/enterprise-ai-platform` |
| PostgreSQL 配置 | `/etc/enterprise-ai-platform/database.env` |
| Redis/RabbitMQ/MinIO 等配置 | `/etc/enterprise-ai-platform/platform.env` |
| DeepSeek/千问 API 配置 | `/etc/enterprise-ai-platform/llm.env` |
| Agent/DB2/通知配置 | `/etc/enterprise-ai-platform/agent.env` |
| PostgreSQL/DB2业务与批准查询目录 | `/etc/enterprise-ai-platform/database-catalog.json` |
| 部署分支和数据库模式 | `/etc/enterprise-ai-platform/deploy.env` |
| 基础镜像不可变 digest | `/etc/enterprise-ai-platform/base-images.env` |

企业发布、公共依赖缓存、Git 版本镜像和无重建回滚的完整说明见
[企业级构建、发布与回滚](enterprise-deployment.md)。

启动顺序：

1. PostgreSQL、Redis、RabbitMQ、Qdrant、MinIO。
2. 数据库迁移和 MinIO 桶初始化。
3. FastAPI、NestJS、Gin、Worker、React。
4. 所有应用健康后最后启动 Nginx。

## 2. 登录并检查虚拟机

在 Windows PowerShell 登录：

```powershell
ssh <虚拟机用户名>@192.168.86.133
```

以下命令均在 Linux SSH 终端执行：

```bash
git --version
docker --version
docker compose version
docker info
sudo ss -lntp | grep ':80 ' || true
free -h
df -h /
```

若 `docker info` 权限不足：

```bash
sudo usermod -aG docker "$USER"
exit
```

退出后重新 SSH 登录。建议至少 4 核 CPU、8 GB 内存和 30 GB 可用磁盘；Qdrant、MinIO、RabbitMQ 和多语言镜像会明显增加资源占用。

## 3. 准备仓库外配置

### 3.1 创建目录和空文件

```bash
# 密钥文件继续使用 600；目录使用 711，让非 root 容器只能穿过但不能列目录。
sudo install -d -m 711 -o "$USER" -g "$(id -gn)" /etc/enterprise-ai-platform
install -m 600 /dev/null /etc/enterprise-ai-platform/database.env
install -m 600 /dev/null /etc/enterprise-ai-platform/platform.env
install -m 600 /dev/null /etc/enterprise-ai-platform/llm.env
install -m 600 /dev/null /etc/enterprise-ai-platform/agent.env
install -m 600 /dev/null /etc/enterprise-ai-platform/deploy.env
```

### 3.2 PostgreSQL 配置

```bash
vi /etc/enterprise-ai-platform/database.env
```

填入并替换密码：

```dotenv
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=enterprise_ai_platform
POSTGRES_USER=enterprise_ai
POSTGRES_PASSWORD=替换成至少32位随机密码
POSTGRES_SSLMODE=disable
```

### 3.3 平台中间件配置

```bash
vi /etc/enterprise-ai-platform/platform.env
```

填入：

```dotenv
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=替换成另一个至少32位随机密码

RABBITMQ_HOST=rabbitmq
RABBITMQ_PORT=5672
RABBITMQ_DEFAULT_USER=enterprise_ai
RABBITMQ_DEFAULT_PASS=替换成另一个至少32位随机密码
RABBITMQ_DEFAULT_VHOST=enterprise_ai
RABBITMQ_TASK_QUEUE=ai_tasks

AI_SERVICE_URL=http://fastapi-service:8000
AI_CONTEXT_TURNS=10

JWT_SECRET=替换成至少64位随机密钥
JWT_ISSUER=enterprise-ai-platform
JWT_AUDIENCE=enterprise-ai-platform-web
JWT_COOKIE_NAME=eai_access
JWT_EXPIRES_SECONDS=3600
COOKIE_SECURE=false

QDRANT_URL=http://qdrant:6333
QDRANT_COLLECTION=ai_task_vectors

MINIO_ENDPOINT=minio:9000
MINIO_ROOT_USER=enterprise_ai_minio
MINIO_ROOT_PASSWORD=替换成另一个至少32位随机密码
MINIO_BUCKET=ai-results
MINIO_USE_SSL=false

LOG_LEVEL=INFO
```

`AI_CONTEXT_TURNS` 控制每次多轮请求携带的最近完整问答轮数，允许 1-20，默认建议 10。轮数越大，上下文更完整，但输入 Token 和费用也会增加。

可用 `openssl rand -hex 48` 生成 JWT 随机密钥。当前通过 HTTP 访问所以 `COOKIE_SECURE=false`；配置 HTTPS 后必须改为 `true`。

### 3.4 大模型配置

```bash
vi /etc/enterprise-ai-platform/llm.env
```

填入真实 Key。此文件不在 Git 仓库内，而且只注入 FastAPI 容器：

```dotenv
DEEPSEEK_API_KEY=替换为真实DeepSeek_API_Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash

QWEN_API_KEY=替换为真实百炼_API_Key
QWEN_BASE_URL=https://替换为WorkspaceId.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus

EMBEDDING_API_KEY=替换为真实向量模型_API_Key
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSION=1024
EMBEDDING_REQUEST_TIMEOUT_SECONDS=60
KNOWLEDGE_CONFIG_FILE=/etc/enterprise-ai-platform/knowledge-base.json

LLM_REQUEST_TIMEOUT_SECONDS=300
LLM_MAX_TOKENS=2048
```

百炼 API Key 与 `QWEN_BASE_URL` 具有地域和业务空间对应关系。Embedding API 也必须使用与 Key 匹配的 OpenAI 兼容地址；不要在聊天、Git、截图或 shell 命令中打印任何 Key。

修改后限制密钥文件权限：

```bash
chmod 600 /etc/enterprise-ai-platform/llm.env
```

创建可热加载的知识库参数文件（不含密钥）：

```bash
cp deploy/knowledge-base.example.json /etc/enterprise-ai-platform/knowledge-base.json
chmod 644 /etc/enterprise-ai-platform/knowledge-base.json
```

修改 `top_k`、`score_threshold`、`candidate_multiplier`、`semantic_weight` 或 `max_context_chars` 后，下一次检索自动生效，无需重启。修改分块参数只影响此后新上传的文档。

### 3.5 Agent 配置

第一阶段可以暂不连接 DB2，先创建以下安全配置：

```bash
vi /etc/enterprise-ai-platform/agent.env
```

```dotenv
AGENT_ENABLED=true
AGENT_MAX_QUERIES=6
AGENT_MAX_EVIDENCE_CHARS=24000
POSTGRES_ENABLED=true
POSTGRES_QUERY_TIMEOUT_SECONDS=30
POSTGRES_MAX_ROWS=500
DATABASE_CATALOG_FILE=/etc/enterprise-ai-platform/database-catalog.json
DB2_ENABLED=false
DB2_QUERY_TIMEOUT_SECONDS=30
DB2_MAX_ROWS=500
REPORT_FILES_ENABLED=true
NOTIFICATION_ENABLED=false
NOTIFICATION_AUTO_SEND=false
```

```bash
chmod 600 /etc/enterprise-ai-platform/agent.env
```

PostgreSQL 连接直接复用 `database.env`。查询目录和 DB2 DSN、通知配置的要求见 `docs/agent-architecture.md`；审核后的目录保存为 `/etc/enterprise-ai-platform/database-catalog.json`。

### 3.6 部署行为配置

```bash
vi /etc/enterprise-ai-platform/deploy.env
```

填入：

```dotenv
DEPLOY_BRANCH=agent/initial-project
DATABASE_MODE=managed
DATABASE_ENV_FILE=/etc/enterprise-ai-platform/database.env
PLATFORM_ENV_FILE=/etc/enterprise-ai-platform/platform.env
LLM_ENV_FILE=/etc/enterprise-ai-platform/llm.env
AGENT_ENV_FILE=/etc/enterprise-ai-platform/agent.env
BASE_IMAGES_FILE=/etc/enterprise-ai-platform/base-images.env
APP_IMAGE_REGISTRY=enterprise-ai-platform
```

`managed` 表示 Compose 负责运行 PostgreSQL。以后使用外部数据库时改为 `external`。

检查文件，不要打印真实密码：

```bash
ls -l /etc/enterprise-ai-platform
grep -v 'PASSWORD\|PASS=' /etc/enterprise-ai-platform/database.env
grep -v 'PASSWORD\|PASS=\|SECRET=' /etc/enterprise-ai-platform/platform.env
grep -E '^(DEEPSEEK_BASE_URL|DEEPSEEK_MODEL|QWEN_BASE_URL|QWEN_MODEL|EMBEDDING_BASE_URL|EMBEDDING_MODEL|EMBEDDING_DIMENSION|KNOWLEDGE_CONFIG_FILE|LLM_)' /etc/enterprise-ai-platform/llm.env
cat /etc/enterprise-ai-platform/knowledge-base.json
grep -E '^(AGENT_|POSTGRES_ENABLED|POSTGRES_QUERY_TIMEOUT_SECONDS|POSTGRES_MAX_ROWS|DATABASE_CATALOG_FILE|DB2_ENABLED|DB2_QUERY_TIMEOUT_SECONDS|DB2_MAX_ROWS|REPORT_FILES_ENABLED|NOTIFICATION_ENABLED|NOTIFICATION_AUTO_SEND)' /etc/enterprise-ai-platform/agent.env
cat /etc/enterprise-ai-platform/deploy.env
```

## 4. 第一次部署：完全手动执行

### 第 1 步：拉取代码

```bash
sudo install -d -m 755 -o "$USER" -g "$(id -gn)" /opt/enterprise-ai-platform
git clone --branch agent/initial-project --single-branch \
  https://github.com/Lizhen2522032337/AI-Platform.git \
  /opt/enterprise-ai-platform
cd /opt/enterprise-ai-platform
git status --short --branch
git log -1 --oneline
```

首次启用 PostgreSQL 查询 Tool 时，复制通用目录模板。此命令只在目标文件不存在时执行，
不会覆盖以后由 DBA 审核过的目录：

```bash
if [ ! -f /etc/enterprise-ai-platform/database-catalog.json ]; then
  # 查询目录不含密码，FastAPI 以非 root 用户运行，因此需要只读权限。
  install -m 644 deploy/database-catalog.example.json \
    /etc/enterprise-ai-platform/database-catalog.json
fi
chmod 711 /etc/enterprise-ai-platform
chmod 644 /etc/enterprise-ai-platform/database-catalog.json
vi /etc/enterprise-ai-platform/database-catalog.json
```

模板里的 `task_status_summary` 可以查询本项目 `ai_tasks`。接入真实生产表时，
再按 `docs/agent-architecture.md` 的格式添加同一查询 ID 的 PostgreSQL/DB2 方言 SQL。

私有仓库应使用 GitHub Deploy Key 或其他安全凭据，不要把令牌写进部署脚本。

### 第 2 步：声明配置路径并检查 Compose

```bash
cd /opt/enterprise-ai-platform
bash ./deploy/scripts/pin-base-images.sh
set -a
source /etc/enterprise-ai-platform/deploy.env
source /etc/enterprise-ai-platform/base-images.env
set +a
export APP_IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
docker compose -f deploy/docker-compose.yml --profile managed-db config --quiet
bash ./deploy/scripts/preflight.sh
```

基础镜像锁只在首次部署和经过审批的运行环境升级时生成，不要在日常发布中重复执行。
检查脚本通过即表示 Compose、仓库外配置、依赖锁、镜像 digest、BuildKit 和磁盘空间满足要求。

### 第 3 步：启动数据和中间件

```bash
docker compose -f deploy/docker-compose.yml --profile managed-db up -d \
  postgres redis rabbitmq qdrant minio
docker compose -f deploy/docker-compose.yml --profile managed-db ps
```

等待 PostgreSQL、Redis 和 RabbitMQ 显示 `healthy`。查看失败服务日志：

```bash
docker compose -f deploy/docker-compose.yml --profile managed-db logs --tail=100 postgres
docker compose -f deploy/docker-compose.yml --profile managed-db logs --tail=100 redis
docker compose -f deploy/docker-compose.yml --profile managed-db logs --tail=100 rabbitmq
docker compose -f deploy/docker-compose.yml --profile managed-db logs --tail=100 qdrant
docker compose -f deploy/docker-compose.yml --profile managed-db logs --tail=100 minio
```

### 第 4 步：初始化存储和数据库

创建 MinIO 结果桶：

```bash
docker compose -f deploy/docker-compose.yml --profile managed-db run --rm minio-init
```

执行 PostgreSQL 幂等迁移：

```bash
docker compose -f deploy/docker-compose.yml --profile managed-db run --rm migrator
```

### 第 5 步：构建全部应用镜像

```bash
docker compose -f deploy/docker-compose.yml --profile managed-db build --pull \
  frontend nest-service fastapi-service gin-service worker
```

第一次会下载 Node.js、Python、Go 和各语言依赖，耗时较长。后续构建会复用：

1. Python 3.13 和 Python 3.11 各自独立的 pip/wheelhouse 缓存。
2. NestJS 与前端共享的 npm 下载缓存，但两者仍使用各自的 `package-lock.json`。
3. Gin 的 Go module 和编译缓存。
4. Dockerfile 中按依赖锁文件分层的完整依赖层。

Python 生产镜像只从 `requirements.lock` 安装，并校验每个分发包的 SHA-256。不要在
运行中的容器内直接安装依赖，否则容器重建后改动会丢失，也无法审计实际运行版本。

### 第 6 步：启动应用，但暂不启动 Nginx

```bash
docker compose -f deploy/docker-compose.yml --profile managed-db up -d \
  frontend fastapi-service nest-service gin-service worker
docker compose -f deploy/docker-compose.yml --profile managed-db ps
```

等待五个应用均变成 `healthy`。如果某个失败：

```bash
docker compose -f deploy/docker-compose.yml --profile managed-db logs --tail=150 nest-service
docker compose -f deploy/docker-compose.yml --profile managed-db logs --tail=150 fastapi-service
docker compose -f deploy/docker-compose.yml --profile managed-db logs --tail=150 gin-service
docker compose -f deploy/docker-compose.yml --profile managed-db logs --tail=150 worker
```

### 第 7 步：创建首个管理员

```bash
bash ./deploy/scripts/create-admin.sh
```

按提示输入管理员用户名、显示名称和至少 12 位密码。密码静默输入，不会保存到 Git 或 shell 历史。

### 第 8 步：最后启动 Nginx

```bash
docker compose -f deploy/docker-compose.yml --profile managed-db up -d nginx
docker compose -f deploy/docker-compose.yml --profile managed-db ps
```

Nginx 应显示 `0.0.0.0:80->80/tcp`。如启用了 DataGrip SSH 隧道，PostgreSQL 还会显示仅本机可访问的 `127.0.0.1:5432->5432/tcp`。

### 第 9 步：虚拟机内验收

```bash
docker compose -f deploy/docker-compose.yml --profile managed-db exec -T nginx wget -qO- http://127.0.0.1/healthz
docker compose -f deploy/docker-compose.yml --profile managed-db exec -T nginx wget -qO- http://127.0.0.1/api/health
docker compose -f deploy/docker-compose.yml --profile managed-db exec -T nginx wget -qO- http://127.0.0.1/realtime/health
```

`/api/tasks` 和 `/realtime/events/*` 已受登录保护，匿名访问返回 401 是正确行为。

### 第 10 步：Windows 验收

在 Windows PowerShell 执行：

```powershell
Test-NetConnection 192.168.86.133 -Port 80
Invoke-RestMethod http://192.168.86.133/healthz
Invoke-RestMethod http://192.168.86.133/api/health
```

登录并提交测试任务：

```powershell
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$securePassword = Read-Host "管理员密码" -AsSecureString
$credential = [pscredential]::new("admin", $securePassword)
$loginBody = @{
  username = "admin"
  password = $credential.GetNetworkCredential().Password
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://192.168.86.133/api/auth/login `
  -WebSession $session -ContentType "application/json" -Body $loginBody

$body = @{
  prompt = "测试企业 AI 异步任务"
  modelProvider = "deepseek"
  databaseType = "postgresql"
} | ConvertTo-Json
$task = Invoke-RestMethod -Method Post -Uri http://192.168.86.133/api/tasks `
  -WebSession $session -ContentType "application/json" -Body $body
$task
Start-Sleep -Seconds 3
Invoke-RestMethod "http://192.168.86.133/api/tasks/$($task.id)" -WebSession $session
```

浏览器打开 `http://192.168.86.133/`，选择 DeepSeek 或通义千问，提交任务并观察 `queued → processing（回答持续出现）→ completed`。

## 5. 以后首次部署：一键脚本

先完成第 3 节的五个配置文件。然后在 Windows PowerShell 复制脚本：

```powershell
scp "D:\LiZhen\StudyMaterials\AI-Platform\enterprise-ai-platform\deploy\scripts\bootstrap-deploy.sh" <虚拟机用户名>@192.168.86.133:/tmp/bootstrap-deploy.sh
```

在 Linux 虚拟机执行：

```bash
chmod +x /tmp/bootstrap-deploy.sh
bash /tmp/bootstrap-deploy.sh agent/initial-project
```

它会克隆代码、验证外部配置、启动基础设施、初始化存储、执行迁移、构建应用、分阶段启动并验收。目标目录非空时脚本会停止，避免覆盖已有代码。

首次脚本完成后仍需交互式创建首个管理员：

```bash
cd /opt/enterprise-ai-platform
bash ./deploy/scripts/create-admin.sh
```

## 6. 后续更新脚本

全部在 Linux 虚拟机执行：

```bash
cd /opt/enterprise-ai-platform
```

| 更新范围 | 命令 |
| --- | --- |
| React | `bash ./deploy/scripts/update-frontend.sh` |
| NestJS | `bash ./deploy/scripts/update-nest.sh` |
| FastAPI | `bash ./deploy/scripts/update-fastapi.sh` |
| Gin | `bash ./deploy/scripts/update-gin.sh` |
| Worker | `bash ./deploy/scripts/update-worker.sh` |
| 四个后端应用 | `bash ./deploy/scripts/update-backends.sh` |
| Nginx | `bash ./deploy/scripts/update-nginx.sh` |
| 多个指定服务 | `bash ./deploy/scripts/update-services.sh nest-service worker` |
| 全部应用 | `bash ./deploy/scripts/update-all.sh` |
| 创建首个管理员 | `bash ./deploy/scripts/create-admin.sh` |

脚本会先检查 Git 工作区，再执行 `fetch` 和 `pull --ff-only`。存在本地改动时会停止，不会覆盖。NestJS 或 Worker 更新前会执行数据库迁移；基础设施配置发生变化时应执行全量更新并人工核对数据兼容性。

所有 `update-*.sh` 如果在本次拉取中发现自身或 `lib/common.sh` 已更新，都会保留部署锁并通过 `exec` 自动重新载入新脚本，然后继续迁移、构建和启动，不再需要人工执行第二次。

更新命令的语义是“明确重新部署”，不以 Git 是否出现新提交作为是否重启的条件：即使代码已经是最新版本，脚本仍会执行镜像构建，并通过 `docker compose up --force-recreate` 强制重新创建目标容器。脚本会记录更新前后的容器 ID；如果原容器存在但 ID 没有变化，更新会直接报错，不能记录为成功发布。

## 7. 状态、日志和验收

```bash
cd /opt/enterprise-ai-platform
bash ./deploy/scripts/status.sh
bash ./deploy/scripts/verify.sh
bash ./deploy/scripts/logs.sh
```

持续查看一个服务，按 `Ctrl+C` 退出：

```bash
bash ./deploy/scripts/logs.sh nest-service
bash ./deploy/scripts/logs.sh worker
bash ./deploy/scripts/logs.sh rabbitmq
bash ./deploy/scripts/logs.sh fastapi-service
```

## 8. 切换外部 PostgreSQL

先备份配置：

```bash
cp /etc/enterprise-ai-platform/database.env /etc/enterprise-ai-platform/database.env.bak
cp /etc/enterprise-ai-platform/deploy.env /etc/enterprise-ai-platform/deploy.env.bak
```

修改 `database.env` 为外部数据库地址，再把 `deploy.env` 的 `DATABASE_MODE` 改成 `external`。执行：

```bash
cd /opt/enterprise-ai-platform
bash ./deploy/scripts/apply-database-config.sh
```

确认 NestJS 和 Worker 正常后，才可以停止旧 PostgreSQL：

```bash
docker compose -f deploy/docker-compose.yml --profile managed-db stop postgres
```

不要删除旧数据卷，直到完成备份和切换验收。

## 9. 回滚与数据安全

```bash
cd /opt/enterprise-ai-platform
bash ./deploy/scripts/rollback.sh
```

也可指定提交：

```bash
bash ./deploy/scripts/rollback.sh <commit-id>
```

回滚只处理代码和应用镜像，不回滚 PostgreSQL、Redis、RabbitMQ、Qdrant、MinIO 数据。
脚本只允许使用已经存在的五个 Commit 版本镜像，并通过 `--no-build` 切换；缺少任何镜像都会
停止，不会在故障期间重新下载依赖或构建旧代码。跨越本次架构重构之前的提交不兼容，应从
本架构第一个完整发布开始作为回滚基线。

严禁执行：

```text
docker compose down -v
docker volume prune
```

这些命令可能删除数据库、队列、向量和对象存储数据。

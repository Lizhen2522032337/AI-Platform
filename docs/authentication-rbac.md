# 登录认证与角色权限设计

## 1. 认证链路

1. React 向 `POST /api/auth/login` 提交用户名和密码。
2. Nginx 将 `/api` 转发给 NestJS。
3. NestJS 按规范化用户名查询 PostgreSQL，并用带独立盐值的 scrypt 校验密码哈希。
4. 验证成功后签发 HS256 JWT，包含用户 ID、角色、权限和 token 版本；`exp` 为 3600 秒。
5. JWT 在响应体返回，同时写入 `HttpOnly; SameSite=Strict` Cookie。HTTP 内网部署的 `COOKIE_SECURE=false`，切换 HTTPS 后必须设为 `true`。
6. NestJS 全局 Guard 验证签名、issuer、audience、过期时间、账号状态和数据库 token 版本。
7. Gin 验证相同 JWT，并通过 Redis 校验 token 版本和任务归属，保护 SSE 实时接口。

浏览器不把 JWT 保存到 localStorage 或 sessionStorage。原生 EventSource 无法设置自定义 Authorization 头，因此采用同源 HttpOnly Cookie，SSE 会自动携带 Cookie。

## 2. 数据库模型

| 表 | 作用 |
| --- | --- |
| `app_users` | 用户名、显示名、scrypt 密码哈希、角色、启用状态、token 版本 |
| `auth_roles` | `admin`、`user` 两个角色 |
| `auth_permissions` | 原子权限代码 |
| `auth_role_permissions` | 角色和权限多对多关系 |
| `ai_tasks.created_by` | 任务所属用户；历史任务允许为空 |

权限矩阵：

| 权限 | 管理员 | 普通用户 |
| --- | :---: | :---: |
| `tasks:create` | 是 | 是 |
| `tasks:read:own` | 是 | 是 |
| `tasks:read:any` | 是 | 否 |
| `users:read` | 是 | 否 |
| `users:manage` | 是 | 否 |

管理员修改用户角色、状态或密码时，`token_version` 立即增加。旧 JWT 即使尚未到一小时，也会被 NestJS 和 Gin 拒绝。

## 3. 任务隔离与实时状态

- NestJS 创建任务时写入 `ai_tasks.created_by`，并将 `ownerId` 放进 RabbitMQ 消息和 Redis 状态。
- Worker 在 `processing/completed/failed` 状态中持续保留 `ownerId`。
- 普通用户查询任务时，NestJS 自动增加 `created_by = 当前用户` 条件。
- Gin 只允许管理员或任务本人订阅 SSE；对浏览器输出前会移除内部 `ownerId` 字段。

## 4. 安全配置

JWT 配置只保存在虚拟机 `/etc/enterprise-ai-platform/platform.env`：

```dotenv
JWT_SECRET=至少64位随机值
JWT_ISSUER=enterprise-ai-platform
JWT_AUDIENCE=enterprise-ai-platform-web
JWT_COOKIE_NAME=eai_access
JWT_EXPIRES_SECONDS=3600
COOKIE_SECURE=false
```

生成随机 JWT 密钥：

```bash
openssl rand -hex 48
```

登录失败按“来源 IP + 用户名”在 Redis 中计数，15 分钟内达到 5 次后返回 429。生产环境必须配置 HTTPS，并将 `COOKIE_SECURE=true`。

## 5. 初始化管理员

完成迁移并构建、启动 NestJS 后，在虚拟机仓库根目录执行：

```bash
bash ./deploy/scripts/create-admin.sh
```

脚本交互式静默读取密码，密码不会进入 Git 和 shell 命令历史。管理员登录后可以在页面底部创建普通用户、修改角色和禁用账号。

## 6. 已运行环境升级步骤

本功能同时修改 React、NestJS、Gin、Worker 和数据库，不能只更新其中一个容器。

1. 先在虚拟机生成密钥并编辑仓库外配置：

```bash
openssl rand -hex 48
vi /etc/enterprise-ai-platform/platform.env
```

补齐第 4 节的六项 JWT/Cookie 配置，禁止把真实密钥提交到 Git。

2. 将本次代码提交、推送到 Git 后，在虚拟机执行全量更新：

```bash
cd /opt/enterprise-ai-platform
bash ./deploy/scripts/update-all.sh
```

该脚本先拉取代码并执行 `002_add_auth_and_rbac.sql`，再重建前端、NestJS、Gin、Worker 和其他应用。具名数据卷不会删除。

3. 创建首个管理员：

```bash
bash ./deploy/scripts/create-admin.sh
```

4. 浏览器打开平台地址。原有历史任务的 `created_by` 为空，只对管理员可见；认证功能上线后创建的新任务会严格绑定登录用户。

以后修改 `JWT_SECRET` 会让所有旧登录立即失效。修改 JWT 配置后需要重新创建 NestJS 和 Gin，并刷新 Nginx：

```bash
docker compose -f deploy/docker-compose.yml --profile managed-db \
  up -d --no-deps --force-recreate nest-service gin-service
docker compose -f deploy/docker-compose.yml --profile managed-db restart nginx
```

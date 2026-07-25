# Enterprise AI Platform

React 前端与 FastAPI、Gin、NestJS 三套后端组成的容器化项目。三套后端共享 PostgreSQL 表 `platform_items`，Nginx 通过虚拟机 `192.168.86.133:80` 提供统一入口。

| 路径 | 服务 |
| --- | --- |
| `/` | React 前端 |
| `/api/fastapi/` | FastAPI |
| `/api/gin/` | Gin |
| `/api/nest/` | NestJS |

## 部署原则

- Windows 家庭版宿主机不运行 Docker。
- Docker 构建和运行全部在 Linux 虚拟机 `192.168.86.133` 完成。
- 应用代码由虚拟机直接从 GitHub 拉取。
- 数据库真实配置保存在仓库外的 `/etc/enterprise-ai-platform/database.env`。

首次完整部署、四个组件的独立更新、更换数据库、验收和回滚命令见 [`docs/deployment-scripts.md`](docs/deployment-scripts.md)。

首次部署入口：

```bash
curl -fsSL \
  https://raw.githubusercontent.com/Lizhen2522032337/AI-Platform/agent/initial-project/deploy/scripts/bootstrap-deploy.sh \
  -o /tmp/bootstrap-deploy.sh
chmod +x /tmp/bootstrap-deploy.sh
/tmp/bootstrap-deploy.sh agent/initial-project
```

独立更新示例：

```bash
cd /opt/enterprise-ai-platform
bash ./deploy/scripts/update-frontend.sh
bash ./deploy/scripts/update-fastapi.sh
bash ./deploy/scripts/update-gin.sh
bash ./deploy/scripts/update-nest.sh
```

这些更新脚本会先安全拉取 Git，再只重建目标服务。

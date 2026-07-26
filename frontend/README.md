# React 前端

前端只通过 Nginx 使用两个公开前缀：

- `/api/`：NestJS 核心业务 API。
- `/realtime/`：Gin SSE 实时任务状态。

前端不直接访问 FastAPI、Worker 或任何数据基础设施。生产构建由根目录 `deploy/docker-compose.yml` 在 Linux 虚拟机完成。

本地开发：

```bash
npm ci
npm run dev
```

`vite.config.ts` 会把 `/api` 和 `/realtime` 代理到虚拟机 `192.168.86.133:80`。

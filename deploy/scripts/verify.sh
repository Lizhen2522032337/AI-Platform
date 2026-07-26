#!/usr/bin/env bash

# 对所有容器、统一入口、健康接口和查询接口执行部署验收。
# HTTP 检查在 Nginx 容器内执行，因此虚拟机无需额外安装 curl。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    ensure_repository
    ensure_docker_compose
    ensure_database_env
    ensure_platform_env
    compose ps

    wait_http 'http://127.0.0.1/healthz' 'Nginx 统一健康检查'
    wait_http 'http://127.0.0.1/' 'React 前端'
    wait_http 'http://127.0.0.1/api/health' 'NestJS 核心后端'
    wait_http 'http://127.0.0.1/api/tasks' 'NestJS 任务查询'
    wait_http 'http://127.0.0.1/realtime/health' 'Gin 实时服务'
    verify_service fastapi-service
    verify_service worker
    log '全部部署验收通过'
}

main "$@"

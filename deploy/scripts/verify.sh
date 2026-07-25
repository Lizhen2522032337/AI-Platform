#!/usr/bin/env bash

# 对所有容器、统一入口、健康接口和查询接口执行部署验收。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    ensure_repository
    ensure_docker_compose
    ensure_env_file
    compose ps

    wait_http 'http://127.0.0.1/' 'React 前端'
    wait_http 'http://127.0.0.1/api/fastapi/health' 'FastAPI 健康检查'
    wait_http 'http://127.0.0.1/api/gin/health' 'Gin 健康检查'
    wait_http 'http://127.0.0.1/api/nest/health' 'NestJS 健康检查'
    wait_http 'http://127.0.0.1/api/fastapi/items' 'FastAPI 数据查询'
    wait_http 'http://127.0.0.1/api/gin/items' 'Gin 数据查询'
    wait_http 'http://127.0.0.1/api/nest/items' 'NestJS 数据查询'
    log '全部部署验收通过'
}

main "$@"

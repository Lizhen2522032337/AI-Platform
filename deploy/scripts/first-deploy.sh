#!/usr/bin/env bash

# 已克隆仓库的首次完整部署：数据库、应用、Nginx 分阶段启动。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    ensure_repository
    ensure_docker_compose
    ensure_database_env
    ensure_platform_env
    acquire_deploy_lock
    compose config --quiet

    # 第一阶段：准备数据库结构。external 模式不会启动本项目的数据库容器。
    start_database_if_managed
    start_infrastructure
    run_migrations

    # 第二阶段：构建并启动全部应用服务，暂不启动统一入口。
    log '构建 React、NestJS、FastAPI、Gin 和 Worker 镜像'
    compose build --pull "${APPLICATION_SERVICES[@]}"
    log '启动前端与全部应用服务容器'
    compose up -d "${APPLICATION_SERVICES[@]}"
    for service in "${APPLICATION_SERVICES[@]}"; do
        wait_for_healthy "${service}"
    done

    # 第三阶段：应用均健康后再启动 Nginx。
    log '启动 Nginx 统一入口'
    compose up -d nginx
    wait_for_healthy nginx
    "${SCRIPT_DIR}/verify.sh"
    log "首次完整部署完成，当前提交：$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
}

main "$@"

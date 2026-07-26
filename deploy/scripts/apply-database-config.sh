#!/usr/bin/env bash

# 修改仓库外的 database.env 后执行：迁移并让 NestJS、Worker 加载新连接。
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
    start_database_if_managed
    run_migrations
    compose up -d --no-deps --force-recreate "${DATABASE_SERVICES[@]}"
    for service in "${DATABASE_SERVICES[@]}"; do
        wait_for_healthy "${service}"
    done
    refresh_nginx
    compose ps
    verify_service nest-service
    verify_service worker
}

main "$@"

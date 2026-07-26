#!/usr/bin/env bash

# 从 Git 拉取代码后，迁移数据库并重建全部服务。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    acquire_deploy_lock
    pull_code "${1:-}"
    ensure_docker_compose
    ensure_database_env
    ensure_platform_env
    start_database_if_managed
    start_infrastructure
    run_migrations
    compose config --quiet
    compose build --pull "${APPLICATION_SERVICES[@]}"
    compose up -d "${APPLICATION_SERVICES[@]}"
    for service in "${APPLICATION_SERVICES[@]}"; do
        wait_for_healthy "${service}"
    done
    compose up -d nginx
    compose restart nginx
    wait_for_healthy nginx
    "${SCRIPT_DIR}/verify.sh"
}

main "$@"

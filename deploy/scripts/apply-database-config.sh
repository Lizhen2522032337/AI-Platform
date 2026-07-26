#!/usr/bin/env bash

# 修改仓库外的 database.env 后执行：迁移并让三套后端加载新的数据库连接。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    ensure_repository
    ensure_docker_compose
    ensure_database_env
    compose config --quiet
    run_migrations
    compose up -d --no-deps --force-recreate \
        fastapi-service gin-service nest-service
    compose restart nginx
    compose ps
    verify_service fastapi-service
    verify_service gin-service
    verify_service nest-service
}

main "$@"

#!/usr/bin/env bash

# 从 Git 拉取代码后，只迁移数据库并重建三套后端；不会重建前端容器。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    local branch="${1:-}"
    local -a backend_services=(
        fastapi-service
        gin-service
        nest-service
    )

    # 单次拉取可以保证三套后端部署自同一个 Git 提交。
    pull_code "${branch}"
    ensure_docker_compose
    ensure_database_env
    compose config --quiet
    run_migrations

    log '构建三套后端镜像'
    compose build "${backend_services[@]}"
    log '只重建三套后端容器'
    compose up -d --no-deps "${backend_services[@]}"

    # 后端容器地址可能变化，重启 Nginx 以刷新上游解析结果。
    compose restart nginx
    compose ps

    verify_service fastapi-service
    verify_service gin-service
    verify_service nest-service
    log '三套后端更新完成，前端容器未重建'
}

main "$@"

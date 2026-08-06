#!/usr/bin/env bash

# 从 Git 拉取代码后，重建 NestJS、FastAPI、Gin 和 Worker；不重建前端。
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
        worker
    )

    # 单次拉取保证全部应用服务来自同一个 Git 提交。
    prepare_update "${BASH_SOURCE[0]}" "${branch}" "$@"
    prepare_deployment_environment
    start_database_if_managed
    start_infrastructure
    run_migrations

    rebuild_and_recreate_services "${backend_services[@]}"

    refresh_nginx
    compose ps

    verify_service fastapi-service
    verify_service gin-service
    verify_service nest-service
    verify_service worker
    record_successful_release components:backends
    log '后端和 Worker 更新完成，前端容器未重建'
}

main "$@"

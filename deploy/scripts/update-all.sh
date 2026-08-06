#!/usr/bin/env bash

# 从 Git 拉取代码后，迁移数据库并重建全部服务。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    prepare_update "${BASH_SOURCE[0]}" "${1:-}" "$@"
    prepare_deployment_environment
    start_database_if_managed
    start_infrastructure
    run_migrations
    # 日常更新复用已缓存的基础镜像；首次部署才强制检查基础镜像更新。
    rebuild_and_recreate_services "${APPLICATION_SERVICES[@]}"
    recreate_nginx
    "${SCRIPT_DIR}/verify.sh"
    record_successful_release full
    log '全部应用服务均已完成构建、容器重建和验收'
}

main "$@"

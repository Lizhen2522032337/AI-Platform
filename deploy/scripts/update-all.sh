#!/usr/bin/env bash

# 从 Git 拉取代码后，迁移数据库并重建全部服务。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    pull_code "${1:-}"
    ensure_docker_compose
    ensure_database_env
    run_migrations
    compose config --quiet
    compose build --pull
    compose up -d --remove-orphans
    "${SCRIPT_DIR}/verify.sh"
}

main "$@"

#!/usr/bin/env bash

# Compose、Dockerfile、数据库迁移或多个基础配置变化时执行完整更新。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    ensure_repository
    ensure_docker_compose
    ensure_env_file
    run_migrations
    compose config --quiet
    compose build --pull
    compose up -d --remove-orphans
    "${SCRIPT_DIR}/verify.sh"
}

main "$@"

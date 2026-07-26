#!/usr/bin/env bash

# 已克隆仓库的首次应用部署：只构建、启动并验收应用容器，不创建或迁移数据库。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    ensure_repository
    ensure_docker_compose
    # 数据库由外部 Docker 环境独立管理；这里只检查应用所需的连接文件是否可读。
    ensure_database_env
    compose config --quiet

    log '构建全部应用服务镜像'
    compose build --pull
    log '启动全部应用服务'
    compose up -d --remove-orphans
    "${SCRIPT_DIR}/verify.sh"
    log "首次应用部署完成，当前提交：$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
}

main "$@"

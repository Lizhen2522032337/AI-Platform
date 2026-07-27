#!/usr/bin/env bash

# 在数据库迁移和 NestJS 镜像构建完成后，交互式创建首个管理员。
# 密码使用静默输入，不写入 Git、命令行参数或 shell 历史。
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

    local username display_name password confirmation
    read -r -p '管理员用户名：' username
    read -r -p '管理员显示名称（直接回车使用“系统管理员”）：' display_name
    read -r -s -p '管理员密码（至少 12 位）：' password
    printf '\n'
    read -r -s -p '再次输入管理员密码：' confirmation
    printf '\n'

    [[ -n "${username}" ]] || die '管理员用户名不能为空'
    [[ "${#password}" -ge 12 ]] || die '管理员密码至少需要 12 位'
    [[ "${password}" == "${confirmation}" ]] || die '两次输入的密码不一致'

    export BOOTSTRAP_ADMIN_USERNAME="${username}"
    export BOOTSTRAP_ADMIN_DISPLAY_NAME="${display_name:-系统管理员}"
    export BOOTSTRAP_ADMIN_PASSWORD="${password}"
    trap 'unset BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_DISPLAY_NAME BOOTSTRAP_ADMIN_PASSWORD password confirmation; rmdir "${DEPLOY_LOCK_DIR}" 2>/dev/null || true' EXIT

    compose run --rm --no-deps \
        -e BOOTSTRAP_ADMIN_USERNAME \
        -e BOOTSTRAP_ADMIN_DISPLAY_NAME \
        -e BOOTSTRAP_ADMIN_PASSWORD \
        nest-service node dist/bootstrap-admin.js
    log '首个管理员创建完成；现在可以打开登录页面'
}

main "$@"

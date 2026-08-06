#!/usr/bin/env bash

# 从 Git 拉取代码后，迁移数据库并重建全部服务。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

deployment_runtime_revision() {
    # 同时检测入口脚本和已 source 的公共函数库。Git 拉取可能替换二者，但当前 Bash
    # 不会自动重新解析已经执行过的文件，因此必须显式 exec 新版本。
    git -C "${REPO_ROOT}" hash-object \
        "${SCRIPT_DIR}/update-all.sh" \
        "${SCRIPT_DIR}/lib/common.sh"
}

restart_after_script_update_if_needed() {
    local previous_revision="$1"
    shift
    local current_revision reexec_count

    current_revision="$(deployment_runtime_revision)"
    [[ "${previous_revision}" != "${current_revision}" ]] || return 0

    reexec_count="${DEPLOY_SELF_REEXEC_COUNT:-0}"
    [[ "${reexec_count}" =~ ^[0-9]+$ ]] || die 'DEPLOY_SELF_REEXEC_COUNT 格式无效'
    ((reexec_count < 2)) || die '部署脚本连续自更新次数过多，请检查部署分支是否稳定'

    log '检测到 update-all.sh 或公共函数库已更新，自动重新载入新脚本后继续部署'
    export DEPLOY_SELF_REEXEC_COUNT="$((reexec_count + 1))"
    exec bash "${SCRIPT_DIR}/update-all.sh" "$@"
}

main() {
    local runtime_revision reexec_count

    reexec_count="${DEPLOY_SELF_REEXEC_COUNT:-0}"
    [[ "${reexec_count}" =~ ^[0-9]+$ ]] || die 'DEPLOY_SELF_REEXEC_COUNT 格式无效'
    if ((reexec_count > 0)); then
        adopt_deploy_lock_after_exec
    else
        acquire_deploy_lock
    fi
    runtime_revision="$(deployment_runtime_revision)"
    pull_code "${1:-}"
    restart_after_script_update_if_needed "${runtime_revision}" "$@"
    ensure_docker_compose
    ensure_database_env
    ensure_platform_env
    ensure_knowledge_config
    run_preflight
    start_database_if_managed
    start_infrastructure
    run_migrations
    compose config --quiet
    # 日常更新复用已缓存的基础镜像；首次部署才强制检查基础镜像更新。
    compose build "${APPLICATION_SERVICES[@]}"
    compose up -d "${APPLICATION_SERVICES[@]}"
    for service in "${APPLICATION_SERVICES[@]}"; do
        wait_for_healthy "${service}"
    done
    compose up -d nginx
    compose restart nginx
    wait_for_healthy nginx
    "${SCRIPT_DIR}/verify.sh"
    record_successful_release full
}

main "$@"

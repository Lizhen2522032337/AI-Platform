#!/usr/bin/env bash

# 直接切换到已经构建并验收过的 Commit 镜像；回滚过程禁止现场重新构建。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    local target_commit="${1:-}"
    local original_commit available_services required_service target_tag

    ensure_repository
    ensure_docker_compose
    ensure_database_env
    ensure_platform_env
    ensure_clean_worktree
    acquire_deploy_lock

    if [[ -z "${target_commit}" ]] && [[ -f "${DEPLOY_STATE_DIR}/previous_release" ]]; then
        target_commit="$(<"${DEPLOY_STATE_DIR}/previous_release")"
    elif [[ -z "${target_commit}" ]] && [[ -f "${DEPLOY_STATE_DIR}/previous_commit" ]]; then
        target_commit="$(<"${DEPLOY_STATE_DIR}/previous_commit")"
    fi
    [[ -n "${target_commit}" ]] || die '没有找到回滚记录，请显式传入 Commit ID'
    git -C "${REPO_ROOT}" cat-file -e "${target_commit}^{commit}" 2>/dev/null \
        || die "Commit 不存在：${target_commit}"

    original_commit="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
    target_tag="$(git -C "${REPO_ROOT}" rev-parse --short=12 "${target_commit}")"
    ensure_release_images "${target_tag}"
    # 先确保当前版本定义的数据基础设施已运行；回滚不会回滚或删除数据。
    start_database_if_managed
    start_infrastructure
    log "回滚应用代码到 ${target_commit}"
    git -C "${REPO_ROOT}" switch --detach "${target_commit}"
    if ! available_services="$(compose config --services 2>/dev/null)"; then
        git -C "${REPO_ROOT}" switch --detach "${original_commit}"
        die '目标提交的 Compose 配置无法解析，已恢复原代码；没有改动容器'
    fi
    for required_service in "${APPLICATION_SERVICES[@]}" nginx; do
        if ! grep -Fxq "${required_service}" <<<"${available_services}"; then
            git -C "${REPO_ROOT}" switch --detach "${original_commit}"
            die "目标提交缺少 ${required_service}，属于旧架构，已恢复原代码"
        fi
    done
    RELEASE_TAG_OVERRIDE="${target_tag}"
    export RELEASE_TAG_OVERRIDE
    log "使用已存在的不可变镜像回滚：image_tag=${target_tag}"
    compose up -d --no-build "${APPLICATION_SERVICES[@]}"
    for service in "${APPLICATION_SERVICES[@]}"; do
        wait_for_healthy "${service}"
    done
    compose up -d nginx
    compose restart nginx
    wait_for_healthy nginx
    compose ps
    # 目标提交可能早于部署脚本，因此回滚后直接使用已加载的公共函数验收。
    wait_http 'http://127.0.0.1/' 'React 前端'
    wait_http 'http://127.0.0.1/api/health' 'NestJS 核心后端'
    wait_http 'http://127.0.0.1/realtime/health' 'Gin 实时服务'
    verify_service fastapi-service
    verify_service worker
    record_successful_release full
    warn '当前处于 detached HEAD，且旧提交中可能没有部署脚本。修复后请先用 git switch 恢复生产分支，再执行完整更新。'
}

main "$@"

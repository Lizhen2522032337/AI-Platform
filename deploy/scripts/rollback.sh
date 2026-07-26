#!/usr/bin/env bash

# 回滚到指定 Commit；不传参数时使用最近一次 pull-code.sh 记录的 Commit。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    local target_commit="${1:-}"

    ensure_repository
    ensure_docker_compose
    ensure_database_env
    ensure_clean_worktree

    if [[ -z "${target_commit}" ]] && [[ -f "${DEPLOY_STATE_DIR}/previous_commit" ]]; then
        target_commit="$(<"${DEPLOY_STATE_DIR}/previous_commit")"
    fi
    [[ -n "${target_commit}" ]] || die '没有找到回滚记录，请显式传入 Commit ID'
    git -C "${REPO_ROOT}" cat-file -e "${target_commit}^{commit}" 2>/dev/null \
        || die "Commit 不存在：${target_commit}"

    log "回滚到 ${target_commit}"
    git -C "${REPO_ROOT}" switch --detach "${target_commit}"
    compose config --quiet
    compose build
    compose up -d --remove-orphans
    compose ps
    # 目标提交可能早于部署脚本，因此回滚后直接使用已加载的公共函数验收。
    wait_http 'http://127.0.0.1/' 'React 前端'
    wait_http 'http://127.0.0.1/api/fastapi/' 'FastAPI 基础入口'
    wait_http 'http://127.0.0.1/api/gin/' 'Gin 基础入口'
    wait_http 'http://127.0.0.1/api/nest/' 'NestJS 基础入口'
    warn '当前处于 detached HEAD，且旧提交中可能没有部署脚本。修复后请先用 git switch 恢复生产分支，再执行完整更新。'
}

main "$@"

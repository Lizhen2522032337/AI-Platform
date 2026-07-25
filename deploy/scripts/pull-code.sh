#!/usr/bin/env bash

# 安全拉取代码并记录更新前 Commit，供 rollback.sh 使用。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    local target_branch="${1:-master}"
    local old_commit old_branch new_commit

    ensure_repository
    require_command git
    ensure_clean_worktree
    old_commit="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
    old_branch="$(git -C "${REPO_ROOT}" branch --show-current)"
    [[ -n "${old_branch}" ]] || old_branch='master'
    record_deploy_state "${old_commit}" "${old_branch}"

    log '从 origin 获取远程提交'
    git -C "${REPO_ROOT}" fetch origin
    if git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${target_branch}"; then
        git -C "${REPO_ROOT}" switch "${target_branch}"
    else
        git -C "${REPO_ROOT}" switch --track -c "${target_branch}" "origin/${target_branch}"
    fi
    git -C "${REPO_ROOT}" pull --ff-only origin "${target_branch}"
    new_commit="$(git -C "${REPO_ROOT}" rev-parse HEAD)"

    printf '更新前：%s\n' "${old_commit}"
    printf '更新后：%s\n' "${new_commit}"
    git -C "${REPO_ROOT}" diff --name-only "${old_commit}" "${new_commit}"
    log "代码拉取完成；请根据文件列表执行对应 update-*.sh"
}

main "$@"

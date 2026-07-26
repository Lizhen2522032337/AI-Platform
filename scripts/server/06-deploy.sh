#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-common.sh
source "$SCRIPT_DIR/00-common.sh"

VERSION="${1:-}"
[[ -n "$VERSION" ]] || die "用法：$0 <版本标签，例如 v1.0.0>"

load_deploy_config
validate_version "$VERSION"

require_command git
require_command docker
require_command flock
require_command curl
require_dir "$REPO_DIR"
require_file "$SHARED_ENV_FILE"

exec 9>"$LOCK_FILE"
flock -n 9 || die "已有其他部署任务正在运行。"

PREVIOUS_VERSION="$(current_version 2>/dev/null || true)"
PREVIOUS_RELEASE_DIR=""
if [[ -n "$PREVIOUS_VERSION" ]]; then
  PREVIOUS_RELEASE_DIR="$(release_dir_for "$PREVIOUS_VERSION")"
fi

rollback_on_failure() {
  local exit_code=$?
  warn "部署 $VERSION 失败，退出码：$exit_code"

  if [[ -n "$PREVIOUS_VERSION" && -d "$PREVIOUS_RELEASE_DIR" ]]; then
    warn "尝试恢复上一版本：$PREVIOUS_VERSION"
    export APP_VERSION="$PREVIOUS_VERSION"
    if compose "$PREVIOUS_RELEASE_DIR" up -d --no-build --remove-orphans --wait --wait-timeout 180; then
      switch_current_link "$PREVIOUS_RELEASE_DIR"
      record_history "AUTO_ROLLBACK" "$PREVIOUS_VERSION" "$(git -C "$PREVIOUS_RELEASE_DIR" rev-parse HEAD)"
      warn "已恢复上一版本。"
    else
      warn "自动恢复失败，需要人工处理。"
    fi
  fi

  exit "$exit_code"
}
trap rollback_on_failure ERR

log "获取 GitHub 最新分支和标签"
git -C "$REPO_DIR" fetch --prune --tags origin

RELEASE_DIR="$(ensure_release_worktree "$VERSION")"
COMPOSE_FILE="$(compose_file_for_release "$RELEASE_DIR")"
require_file "$COMPOSE_FILE"

COMMIT_SHA="$(git -C "$RELEASE_DIR" rev-parse HEAD)"
TAG_TYPE="$(git -C "$REPO_DIR" cat-file -t "$VERSION")"
[[ "$TAG_TYPE" == "tag" ]] || warn "$VERSION 不是 annotated tag，建议正式版本使用 git tag -a。"

export APP_VERSION="$VERSION"

log "验证 Compose 配置"
compose "$RELEASE_DIR" config --quiet

if [[ -x "$RELEASE_DIR/deploy/hooks/pre-deploy.sh" ]]; then
  log "执行 pre-deploy hook"
  "$RELEASE_DIR/deploy/hooks/pre-deploy.sh" "$VERSION"
fi

log "保存部署前状态"
"$SCRIPT_DIR/10-backup-config-and-state.sh" "before-$VERSION"

build_args=()
if [[ "${PULL_BASE_IMAGES:-false}" == "true" ]]; then
  build_args+=(--pull)
fi

log "构建应用镜像：$VERSION"
compose "$RELEASE_DIR" build "${build_args[@]}"

log "启动或更新容器"
compose "$RELEASE_DIR" up \
  -d \
  --no-build \
  --remove-orphans \
  --wait \
  --wait-timeout 240

log "执行健康检查"
"$SCRIPT_DIR/05-healthcheck.sh"

if [[ -x "$RELEASE_DIR/deploy/hooks/post-deploy.sh" ]]; then
  log "执行 post-deploy hook"
  "$RELEASE_DIR/deploy/hooks/post-deploy.sh" "$VERSION"
fi

switch_current_link "$RELEASE_DIR"
printf '%s\n' "$VERSION" > "$STATE_DIR/current-version"
printf '%s\n' "$COMMIT_SHA" > "$STATE_DIR/current-commit"
record_history "DEPLOY" "$VERSION" "$COMMIT_SHA"

trap - ERR

log "部署完成"
log "版本：$VERSION"
log "提交：$COMMIT_SHA"
log "当前目录：$(readlink -f "$CURRENT_LINK")"

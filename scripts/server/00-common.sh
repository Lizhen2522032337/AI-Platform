#!/usr/bin/env bash
set -Eeuo pipefail

DEFAULT_DEPLOY_CONFIG="/opt/enterprise-ai-platform/shared/deploy.conf"

log() {
  printf '%s [INFO] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

warn() {
  printf '%s [WARN] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

die() {
  printf '%s [ERROR] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

require_file() {
  [[ -f "$1" ]] || die "文件不存在：$1"
}

require_dir() {
  [[ -d "$1" ]] || die "目录不存在：$1"
}

load_deploy_config() {
  local config_file="${DEPLOY_CONFIG:-$DEFAULT_DEPLOY_CONFIG}"
  require_file "$config_file"

  # shellcheck disable=SC1090
  source "$config_file"

  : "${APP_NAME:?deploy.conf 缺少 APP_NAME}"
  : "${APP_ROOT:?deploy.conf 缺少 APP_ROOT}"
  : "${REPO_DIR:?deploy.conf 缺少 REPO_DIR}"
  : "${RELEASES_DIR:?deploy.conf 缺少 RELEASES_DIR}"
  : "${SHARED_DIR:?deploy.conf 缺少 SHARED_DIR}"
  : "${SHARED_ENV_FILE:?deploy.conf 缺少 SHARED_ENV_FILE}"
  : "${COMPOSE_RELATIVE_PATH:?deploy.conf 缺少 COMPOSE_RELATIVE_PATH}"
  : "${COMPOSE_PROJECT_NAME:?deploy.conf 缺少 COMPOSE_PROJECT_NAME}"
  : "${DEFAULT_BRANCH:?deploy.conf 缺少 DEFAULT_BRANCH}"
  : "${HEALTHCHECK_URL:?deploy.conf 缺少 HEALTHCHECK_URL}"
  : "${KEEP_RELEASES:?deploy.conf 缺少 KEEP_RELEASES}"

  CURRENT_LINK="${CURRENT_LINK:-$APP_ROOT/current}"
  HISTORY_FILE="${HISTORY_FILE:-$SHARED_DIR/deployment-history.log}"
  LOCK_FILE="${LOCK_FILE:-$SHARED_DIR/deploy.lock}"
  STATE_DIR="${STATE_DIR:-$SHARED_DIR/state}"

  mkdir -p "$RELEASES_DIR" "$STATE_DIR"
}

validate_version() {
  local version="$1"
  [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] ||
    die "版本格式错误：$version。示例：v1.0.0"
}

release_dir_for() {
  printf '%s/%s' "$RELEASES_DIR" "$1"
}

compose_file_for_release() {
  local release_dir="$1"
  printf '%s/%s' "$release_dir" "$COMPOSE_RELATIVE_PATH"
}

compose() {
  local release_dir="$1"
  shift

  local compose_file
  compose_file="$(compose_file_for_release "$release_dir")"
  require_file "$compose_file"

  APP_VERSION="${APP_VERSION:?APP_VERSION 未设置}" \
  RELEASE_DIR="$release_dir" \
  SHARED_DIR="$SHARED_DIR" \
  SHARED_ENV_FILE="$SHARED_ENV_FILE" \
    docker compose \
      --project-name "$COMPOSE_PROJECT_NAME" \
      --env-file "$SHARED_ENV_FILE" \
      -f "$compose_file" \
      "$@"
}

current_version() {
  if [[ -L "$CURRENT_LINK" ]]; then
    basename "$(readlink -f "$CURRENT_LINK")"
  else
    return 1
  fi
}

record_history() {
  local action="$1"
  local version="$2"
  local commit="$3"
  printf '%s|%s|%s|%s|%s\n' \
    "$(date --iso-8601=seconds)" \
    "$action" \
    "$version" \
    "$commit" \
    "$(id -un)" >> "$HISTORY_FILE"
}

switch_current_link() {
  local release_dir="$1"
  local tmp_link="$APP_ROOT/.current.tmp"

  ln -sfn "$release_dir" "$tmp_link"
  mv -Tf "$tmp_link" "$CURRENT_LINK"
}

ensure_release_worktree() {
  local version="$1"
  local release_dir
  release_dir="$(release_dir_for "$version")"

  git -C "$REPO_DIR" rev-parse --verify "refs/tags/$version" >/dev/null 2>&1 ||
    die "仓库中不存在标签：$version"

  if [[ ! -d "$release_dir" ]]; then
    log "创建版本工作目录：$release_dir"
    git -C "$REPO_DIR" worktree add --detach "$release_dir" "refs/tags/$version"
  else
    local actual_commit expected_commit
    actual_commit="$(git -C "$release_dir" rev-parse HEAD)"
    expected_commit="$(git -C "$REPO_DIR" rev-list -n 1 "$version")"
    [[ "$actual_commit" == "$expected_commit" ]] ||
      die "版本目录已存在但提交不一致：$release_dir"
  fi

  printf '%s' "$release_dir"
}

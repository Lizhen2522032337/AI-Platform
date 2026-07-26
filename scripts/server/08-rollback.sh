#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-common.sh
source "$SCRIPT_DIR/00-common.sh"

TARGET_VERSION="${1:-}"

load_deploy_config

exec 9>"$LOCK_FILE"
flock -n 9 || die "已有其他部署任务正在运行。"

if [[ -z "$TARGET_VERSION" ]]; then
  CURRENT_VERSION="$(current_version 2>/dev/null || true)"
  TARGET_VERSION="$(
    awk -F'|' -v current="$CURRENT_VERSION" '
      $2 == "DEPLOY" && $3 != current { candidate=$3 }
      END { print candidate }
    ' "$HISTORY_FILE" 2>/dev/null || true
  )"
fi

[[ -n "$TARGET_VERSION" ]] ||
  die "无法自动确定回滚版本。请执行：$0 v1.0.0"

validate_version "$TARGET_VERSION"

TARGET_RELEASE_DIR="$(release_dir_for "$TARGET_VERSION")"
require_dir "$TARGET_RELEASE_DIR"

export APP_VERSION="$TARGET_VERSION"

log "验证回滚版本 Compose 配置"
compose "$TARGET_RELEASE_DIR" config --quiet

if ! compose "$TARGET_RELEASE_DIR" up \
  -d \
  --no-build \
  --remove-orphans \
  --wait \
  --wait-timeout 240; then
  warn "本地缺少旧镜像，尝试重新构建回滚版本。"
  compose "$TARGET_RELEASE_DIR" build
  compose "$TARGET_RELEASE_DIR" up \
    -d \
    --no-build \
    --remove-orphans \
    --wait \
    --wait-timeout 240
fi

"$SCRIPT_DIR/05-healthcheck.sh"

switch_current_link "$TARGET_RELEASE_DIR"
COMMIT_SHA="$(git -C "$TARGET_RELEASE_DIR" rev-parse HEAD)"
printf '%s\n' "$TARGET_VERSION" > "$STATE_DIR/current-version"
printf '%s\n' "$COMMIT_SHA" > "$STATE_DIR/current-commit"
record_history "ROLLBACK" "$TARGET_VERSION" "$COMMIT_SHA"

log "回滚完成：$TARGET_VERSION"
warn "本脚本不会自动回滚数据库结构。正式版本应禁止不可逆数据库迁移。"

#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-common.sh
source "$SCRIPT_DIR/00-common.sh"

VERSION="${1:-}"
SERVICE="${2:-}"

[[ -n "$VERSION" && -n "$SERVICE" ]] ||
  die "用法：$0 <版本标签> <服务名，例如 frontend|nest-api|ai-service|realtime-service|worker|nginx>"

load_deploy_config
validate_version "$VERSION"

allowed_services=(frontend nest-api ai-service realtime-service worker nginx)
if [[ ! " ${allowed_services[*]} " =~ " ${SERVICE} " ]]; then
  die "不允许的服务名：$SERVICE。允许值：${allowed_services[*]}"
fi

exec 9>"$LOCK_FILE"
flock -n 9 || die "已有其他部署任务正在运行。"

git -C "$REPO_DIR" fetch --prune --tags origin
RELEASE_DIR="$(ensure_release_worktree "$VERSION")"
COMMIT_SHA="$(git -C "$RELEASE_DIR" rev-parse HEAD)"

export APP_VERSION="$VERSION"

log "验证 Compose 配置"
compose "$RELEASE_DIR" config --quiet

log "构建服务：$SERVICE"
compose "$RELEASE_DIR" build "$SERVICE"

log "仅更新服务：$SERVICE"
compose "$RELEASE_DIR" up \
  -d \
  --no-deps \
  --no-build \
  --wait \
  --wait-timeout 180 \
  "$SERVICE"

docker compose --project-name "$COMPOSE_PROJECT_NAME" ps "$SERVICE"

mkdir -p "$STATE_DIR/service-versions"
printf '%s|%s|%s\n' "$VERSION" "$COMMIT_SHA" "$(date --iso-8601=seconds)" \
  > "$STATE_DIR/service-versions/$SERVICE"

record_history "DEPLOY_SERVICE:$SERVICE" "$VERSION" "$COMMIT_SHA"
log "单服务更新完成。注意：此时系统可能处于混合版本状态。"

#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-common.sh
source "$SCRIPT_DIR/00-common.sh"

load_deploy_config

MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"
SLEEP_SECONDS="${SLEEP_SECONDS:-5}"

log "检查容器状态"
docker compose --project-name "$COMPOSE_PROJECT_NAME" ps

log "检查外部健康地址：$HEALTHCHECK_URL"

for ((attempt=1; attempt<=MAX_ATTEMPTS; attempt++)); do
  if curl --fail --silent --show-error --max-time 5 "$HEALTHCHECK_URL" >/dev/null; then
    log "健康检查通过，第 $attempt 次成功。"
    exit 0
  fi

  warn "第 $attempt/$MAX_ATTEMPTS 次检查失败，${SLEEP_SECONDS}s 后重试。"
  sleep "$SLEEP_SECONDS"
done

warn "健康检查失败，输出最近日志。"
docker compose \
  --project-name "$COMPOSE_PROJECT_NAME" \
  logs --tail=200 || true

exit 1

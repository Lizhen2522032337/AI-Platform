#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-common.sh
source "$SCRIPT_DIR/00-common.sh"

load_deploy_config

echo "========== Deployment =========="
echo "Application : $APP_NAME"
echo "Root        : $APP_ROOT"
echo "Current     : $(current_version 2>/dev/null || echo 'not deployed')"
echo "Current dir : $(readlink -f "$CURRENT_LINK" 2>/dev/null || echo '-')"
echo ""

echo "========== Git Repository =========="
git -C "$REPO_DIR" remote -v || true
git -C "$REPO_DIR" status --short --branch || true
echo ""

echo "========== Docker Compose =========="
docker compose --project-name "$COMPOSE_PROJECT_NAME" ps
echo ""

echo "========== Disk =========="
df -h "$APP_ROOT"
echo ""

echo "========== Recent Deployment History =========="
tail -n 20 "$HISTORY_FILE" 2>/dev/null || true
echo ""

echo "========== Service Version Overrides =========="
if [[ -d "$STATE_DIR/service-versions" ]]; then
  find "$STATE_DIR/service-versions" -maxdepth 1 -type f -print -exec cat {} \;
else
  echo "none"
fi

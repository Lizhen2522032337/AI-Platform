#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-common.sh
source "$SCRIPT_DIR/00-common.sh"

LABEL="${1:-manual}"
load_deploy_config

timestamp="$(date '+%Y%m%d-%H%M%S')"
backup_dir="$SHARED_DIR/backups/config-$timestamp-$LABEL"
mkdir -p "$backup_dir"

cp -a "$SHARED_ENV_FILE" "$backup_dir/.env.production"
cp -a "$DEPLOY_CONFIG" "$backup_dir/deploy.conf"

if [[ -f "$HISTORY_FILE" ]]; then
  cp -a "$HISTORY_FILE" "$backup_dir/"
fi

if [[ -d "$STATE_DIR" ]]; then
  cp -a "$STATE_DIR" "$backup_dir/"
fi

docker compose --project-name "$COMPOSE_PROJECT_NAME" ps \
  > "$backup_dir/docker-compose-ps.txt" 2>&1 || true

docker image ls \
  --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}' \
  > "$backup_dir/docker-images.txt" 2>&1 || true

tar -C "$SHARED_DIR/backups" \
  -czf "$backup_dir.tar.gz" \
  "$(basename "$backup_dir")"

rm -rf "$backup_dir"
chmod 600 "$backup_dir.tar.gz"

log "配置和部署状态已备份：$backup_dir.tar.gz"
warn "此脚本不包含 PostgreSQL、Qdrant、MinIO 等业务数据备份。业务数据需按独立备份策略处理。"

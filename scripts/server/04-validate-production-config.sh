#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-common.sh
source "$SCRIPT_DIR/00-common.sh"

load_deploy_config

require_command git
require_command docker
require_command curl
require_command flock

require_dir "$REPO_DIR"
require_file "$SHARED_ENV_FILE"

docker info >/dev/null 2>&1 || die "当前用户无法访问 Docker。请重新登录或检查 docker 组。"
docker compose version >/dev/null 2>&1 || die "Docker Compose 插件不可用。"

file_mode="$(stat -c '%a' "$SHARED_ENV_FILE")"
if [[ "$file_mode" != "600" && "$file_mode" != "640" ]]; then
  warn "$SHARED_ENV_FILE 权限为 $file_mode，建议设置为 600 或 640。"
fi

required_vars=(
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  REDIS_PASSWORD
  RABBITMQ_DEFAULT_USER
  RABBITMQ_DEFAULT_PASS
  MINIO_ROOT_USER
  MINIO_ROOT_PASSWORD
  JWT_SECRET
)

missing=()
for key in "${required_vars[@]}"; do
  if ! grep -Eq "^${key}=.+" "$SHARED_ENV_FILE"; then
    missing+=("$key")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf '以下生产环境变量缺失：\n' >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

if grep -Eq 'CHANGE_ME|replace-me|example-password|your-secret' "$SHARED_ENV_FILE"; then
  die "生产环境文件仍包含示例占位值，请先替换。"
fi

log "生产配置基础检查通过。"

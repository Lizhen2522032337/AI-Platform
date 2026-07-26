#!/usr/bin/env bash

# 查看容器日志。
# 用法：logs.sh                    查看所有服务最近 200 行
#      logs.sh fastapi-service    持续查看某个服务
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

service="${1:-}"
lines="${LINES:-200}"

ensure_repository
ensure_docker_compose

if [[ -n "${service}" ]]; then
    case "${service}" in
        postgres|redis|rabbitmq|qdrant|minio|frontend|fastapi-service|gin-service|nest-service|worker|nginx) ;;
        *) die "不支持的服务：${service}" ;;
    esac
    compose logs --tail="${lines}" -f "${service}"
else
    compose logs --tail="${lines}"
fi

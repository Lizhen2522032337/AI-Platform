#!/usr/bin/env bash

# 同时更新指定服务，例如：update-services.sh frontend fastapi-service
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    local service
    local needs_migration=0
    local includes_nginx=0
    local -a build_services=()

    (($# > 0)) || die '请至少指定一个服务'
    ensure_repository
    ensure_docker_compose
    ensure_env_file
    compose config --quiet

    for service in "$@"; do
        validate_service "${service}"
        if is_backend_service "${service}"; then
            needs_migration=1
        fi
        if [[ "${service}" == 'nginx' ]]; then
            includes_nginx=1
        else
            build_services+=("${service}")
        fi
    done

    if ((needs_migration)); then
        run_migrations
    fi
    if ((${#build_services[@]} > 0)); then
        compose build "${build_services[@]}"
        compose up -d --no-deps "${build_services[@]}"
    fi
    if ((includes_nginx)); then
        compose run --rm --no-deps nginx nginx -t
        compose up -d --no-deps --force-recreate nginx
    else
        compose restart nginx
    fi

    compose ps
    for service in "$@"; do
        verify_service "${service}"
    done
}

main "$@"

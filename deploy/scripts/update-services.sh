#!/usr/bin/env bash

# 从 Git 拉取后同时更新多个服务，例如：update-services.sh frontend fastapi-service。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    local branch=''
    local service
    local needs_migration=0
    local needs_infrastructure=0
    local includes_nginx=0
    local -a requested_services=()
    local -a build_services=()
    local -a original_args=("$@")

    if [[ "${1:-}" == '--branch' ]]; then
        (($# >= 3)) || die '用法：update-services.sh --branch <分支> <服务...>'
        branch="$2"
        shift 2
    fi
    (($# > 0)) || die '请至少指定一个服务'
    requested_services=("$@")

    prepare_update "${BASH_SOURCE[0]}" "${branch}" "${original_args[@]}"
    prepare_deployment_environment

    for service in "${requested_services[@]}"; do
        validate_service "${service}"
        if is_backend_service "${service}"; then
            needs_infrastructure=1
        fi
        if uses_database "${service}"; then
            needs_migration=1
        fi
        if [[ "${service}" == 'nginx' ]]; then
            includes_nginx=1
        else
            build_services+=("${service}")
        fi
    done

    if ((needs_infrastructure)); then
        start_infrastructure
    fi
    if ((needs_migration)); then
        start_database_if_managed
        run_migrations
    fi
    if ((${#build_services[@]} > 0)); then
        rebuild_and_recreate_services "${build_services[@]}"
    fi
    if ((includes_nginx)); then
        recreate_nginx
    else
        refresh_nginx
    fi

    compose ps
    for service in "${requested_services[@]}"; do
        verify_service "${service}"
    done
    record_successful_release "components:$(IFS=,; printf '%s' "${requested_services[*]}")"
}

main "$@"

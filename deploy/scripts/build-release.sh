#!/usr/bin/env bash

# 在当前干净 Commit 上构建不可变版本镜像；可选推送到已经登录的企业镜像仓库。
# 用法：build-release.sh [--push] [frontend fastapi-service ...]
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

main() {
    local push_images=0 service image_ref image_id manifest_file
    local -a services=()

    if [[ "${1:-}" == '--push' ]]; then
        push_images=1
        shift
    fi
    if (($# > 0)); then
        services=("$@")
    else
        services=("${APPLICATION_SERVICES[@]}")
    fi
    for service in "${services[@]}"; do
        validate_service "${service}"
        [[ "${service}" != 'nginx' ]] || die 'nginx 是外部基础镜像，不属于应用发布镜像'
    done

    ensure_repository
    ensure_clean_worktree
    ensure_docker_compose
    compose config --quiet
    run_preflight
    acquire_deploy_lock
    log "构建不可变发布镜像：tag=$(release_tag) services=${services[*]}"
    compose build "${services[@]}"

    mkdir -p "${DEPLOY_STATE_DIR}"
    manifest_file="${DEPLOY_STATE_DIR}/image-manifest-$(release_tag).tsv"
    : >"${manifest_file}"
    for service in "${services[@]}"; do
        image_ref="$(application_image_ref "${service}")"
        image_id="$(docker image inspect --format '{{.Id}}' "${image_ref}")"
        printf '%s\t%s\n' "${image_ref}" "${image_id}" >>"${manifest_file}"
    done

    if ((push_images)); then
        [[ "${APP_IMAGE_REGISTRY}" != 'enterprise-ai-platform' ]] \
            || die '推送前必须在 deploy.env 配置企业 APP_IMAGE_REGISTRY'
        compose push "${services[@]}"
        log "镜像已推送到企业仓库：${APP_IMAGE_REGISTRY}"
    fi
    log "发布镜像清单：${manifest_file}"
}

main "$@"

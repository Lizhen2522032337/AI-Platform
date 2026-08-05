#!/usr/bin/env bash

# 拉取经过确认的基础镜像标签，并把当前 Linux 架构对应的不可变 digest
# 写入 Git 仓库之外。之后的构建和启动都复用这些 digest，不会因上游标签漂移。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

readonly TARGET_FILE="${BASE_IMAGES_FILE}"
readonly -a IMAGE_SPECS=(
    'PYTHON_FASTAPI_BASE_IMAGE|python:3.13-slim'
    'PYTHON_WORKER_BASE_IMAGE|python:3.11-slim'
    'NODE_BASE_IMAGE|node:22-alpine'
    'GO_BASE_IMAGE|golang:1.26-alpine'
    'ALPINE_BASE_IMAGE|alpine:latest'
    'NGINX_BASE_IMAGE|nginx:alpine'
    'POSTGRES_IMAGE|postgres:16-alpine'
    'REDIS_IMAGE|redis:7-alpine'
    'RABBITMQ_IMAGE|rabbitmq:4.3.4-management-alpine'
    'QDRANT_IMAGE|qdrant/qdrant:v1.18.3'
    'MINIO_IMAGE|minio/minio:RELEASE.2025-09-07T16-13-09Z-cpuv1'
    'MINIO_MC_IMAGE|minio/mc:RELEASE.2025-08-13T08-35-41Z-cpuv1'
)

main() {
    local spec variable image repo_digest temp_file

    ensure_docker_compose
    require_command install
    temp_file="$(mktemp)"
    trap 'rm -f "${temp_file}"' EXIT

    {
        printf '# 由 pin-base-images.sh 生成；不包含密钥。\n'
        printf '# 更新时间：%s\n' "$(date --iso-8601=seconds)"
        for spec in "${IMAGE_SPECS[@]}"; do
            variable="${spec%%|*}"
            image="${spec#*|}"
            log "拉取并固定基础镜像：${image}" >&2
            docker pull "${image}" >/dev/null
            repo_digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "${image}")"
            [[ "${repo_digest}" == *@sha256:* ]] \
                || die "无法取得镜像 digest：${image}"
            printf '%s=%q\n' "${variable}" "${repo_digest}"
        done
    } >"${temp_file}"

    if [[ ${EUID} -eq 0 ]]; then
        install -D -m 644 "${temp_file}" "${TARGET_FILE}"
    else
        require_command sudo
        sudo install -D -m 644 "${temp_file}" "${TARGET_FILE}"
    fi
    log "基础镜像已固定：${TARGET_FILE}"
    warn '以后只有经过审批的运行环境升级，才重新执行本脚本。'
}

main "$@"

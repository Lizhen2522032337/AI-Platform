#!/usr/bin/env bash

# 企业发布前只读检查：配置、基础镜像锁、依赖锁、Docker/BuildKit 和磁盘空间。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

readonly -a REQUIRED_BASE_IMAGE_VARIABLES=(
    PYTHON_FASTAPI_BASE_IMAGE PYTHON_WORKER_BASE_IMAGE NODE_BASE_IMAGE
    GO_BASE_IMAGE ALPINE_BASE_IMAGE NGINX_BASE_IMAGE POSTGRES_IMAGE REDIS_IMAGE
    RABBITMQ_IMAGE QDRANT_IMAGE MINIO_IMAGE MINIO_MC_IMAGE
)

main() {
    local variable value available_kb minimum_kb

    ensure_repository
    ensure_clean_worktree
    ensure_docker_compose
    ensure_database_env
    ensure_platform_env
    require_command docker
    require_command sha256sum
    docker buildx version >/dev/null 2>&1 || die '缺少 Docker Buildx/BuildKit'
    [[ -r "${BASE_IMAGES_FILE}" ]] \
        || die "缺少基础镜像锁：${BASE_IMAGES_FILE}；请先执行 pin-base-images.sh"

    for variable in "${REQUIRED_BASE_IMAGE_VARIABLES[@]}"; do
        value="${!variable:-}"
        [[ "${value}" == *@sha256:* ]] \
            || die "${BASE_IMAGES_FILE} 中的 ${variable} 没有固定到 sha256 digest"
    done
    [[ -s "${REPO_ROOT}/backend/fastapi-service/requirements.lock" ]] \
        || die '缺少 FastAPI requirements.lock'
    [[ -s "${REPO_ROOT}/backend/fastapi-service/requirements-dev.lock" ]] \
        || die '缺少 FastAPI requirements-dev.lock'
    [[ -s "${REPO_ROOT}/backend/worker/requirements.lock" ]] \
        || die '缺少 Worker requirements.lock'
    [[ -s "${REPO_ROOT}/backend/worker/requirements-dev.lock" ]] \
        || die '缺少 Worker requirements-dev.lock'
    [[ -s "${REPO_ROOT}/backend/nest-service/package-lock.json" ]] \
        || die '缺少 NestJS package-lock.json'
    [[ -s "${REPO_ROOT}/frontend/package-lock.json" ]] \
        || die '缺少前端 package-lock.json'
    [[ -s "${REPO_ROOT}/backend/gin-service/go.sum" ]] \
        || die '缺少 Gin go.sum'
    (
        cd "${REPO_ROOT}/backend/fastapi-service"
        sha256sum -c python-lock.manifest.sha256 >/dev/null
    ) || die 'FastAPI Python lock 清单不一致，请重新生成 lock'
    (
        cd "${REPO_ROOT}/backend/worker"
        sha256sum -c python-lock.manifest.sha256 >/dev/null
    ) || die 'Worker Python lock 清单不一致，请重新生成 lock'

    compose config --quiet
    minimum_kb=$((10 * 1024 * 1024))
    available_kb="$(df -Pk "${REPO_ROOT}" | awk 'NR==2 {print $4}')"
    [[ "${available_kb}" =~ ^[0-9]+$ ]] || die '无法读取部署磁盘剩余空间'
    ((available_kb >= minimum_kb)) \
        || die '部署磁盘剩余空间不足 10 GiB，请先处理镜像和日志占用'

    log "发布前检查通过：commit=$(git -C "${REPO_ROOT}" rev-parse --short=12 HEAD)"
    docker system df
}

main "$@"

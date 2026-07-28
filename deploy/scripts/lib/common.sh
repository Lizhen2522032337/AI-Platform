#!/usr/bin/env bash

# Linux 部署脚本公共函数。
# 真实数据库配置始终位于仓库外，脚本不会把密码写入 Git 工作区。
set -Eeuo pipefail

readonly COMMON_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR="$(cd -- "${COMMON_DIR}/.." && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

# deploy.env 只保存分支和数据库模式等非敏感选项。
DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE:-/etc/enterprise-ai-platform/deploy.env}"
if [[ -f "${DEPLOY_CONFIG_FILE}" ]]; then
    # shellcheck disable=SC1090
    source "${DEPLOY_CONFIG_FILE}"
fi

readonly COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.yml"
readonly DATABASE_ENV_FILE="${DATABASE_ENV_FILE:-/etc/enterprise-ai-platform/database.env}"
readonly PLATFORM_ENV_FILE="${PLATFORM_ENV_FILE:-/etc/enterprise-ai-platform/platform.env}"
readonly LLM_ENV_FILE="${LLM_ENV_FILE:-/etc/enterprise-ai-platform/llm.env}"
readonly DATABASE_MODE="${DATABASE_MODE:-managed}"
readonly DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-${HOME}/.local/state/enterprise-ai-platform}"
readonly DEPLOY_LOCK_DIR="${DEPLOY_STATE_DIR}/deploy.lock"
readonly -a INFRASTRUCTURE_SERVICES=(redis rabbitmq qdrant minio)
readonly -a APPLICATION_SERVICES=(frontend fastapi-service nest-service gin-service worker)
readonly -a BACKEND_SERVICES=(fastapi-service nest-service gin-service worker)
readonly -a DATABASE_SERVICES=(nest-service worker)
export DATABASE_ENV_FILE PLATFORM_ENV_FILE LLM_ENV_FILE

log() {
    printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

warn() {
    printf '[%s] 警告：%s\n' "$(date '+%F %T')" "$*" >&2
}

die() {
    printf '[%s] 错误：%s\n' "$(date '+%F %T')" "$*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

ensure_repository() {
    require_command git
    git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
        || die "${REPO_ROOT} 不是 Git 仓库"
    [[ -f "${COMPOSE_FILE}" ]] || die "找不到 ${COMPOSE_FILE}"
}

ensure_docker_compose() {
    require_command docker
    docker compose version >/dev/null 2>&1 || die '未安装 Docker Compose v2 插件'
    docker info >/dev/null 2>&1 \
        || die '当前用户无法连接 Docker；请检查 Docker 服务和 docker 用户组权限'
}

ensure_database_env() {
    local key configured_host
    local -a required_keys=(
        POSTGRES_HOST
        POSTGRES_PORT
        POSTGRES_DB
        POSTGRES_USER
        POSTGRES_PASSWORD
        POSTGRES_SSLMODE
    )

    [[ -f "${DATABASE_ENV_FILE}" ]] \
        || die "找不到独立数据库配置：${DATABASE_ENV_FILE}"
    [[ -r "${DATABASE_ENV_FILE}" ]] \
        || die "当前用户无法读取数据库配置：${DATABASE_ENV_FILE}"

    for key in "${required_keys[@]}"; do
        grep -Eq "^[[:space:]]*${key}=.+$" "${DATABASE_ENV_FILE}" \
            || die "${DATABASE_ENV_FILE} 缺少 ${key}"
    done

    grep -Eqi 'change_me|请替换|实际密码|your_password' "${DATABASE_ENV_FILE}" \
        && die "${DATABASE_ENV_FILE} 仍包含示例占位值，请先填写真实配置"

    case "${DATABASE_MODE}" in
        managed|external) ;;
        *) die "DATABASE_MODE 只能是 managed 或 external，当前值：${DATABASE_MODE}" ;;
    esac

    if [[ "${DATABASE_MODE}" == 'managed' ]]; then
        configured_host="$(awk -F= '/^[[:space:]]*POSTGRES_HOST=/{sub(/^[^=]*=/, ""); gsub(/^[[:space:]]+|[[:space:]]+$/, ""); gsub(/^"|"$/, ""); print; exit}' "${DATABASE_ENV_FILE}")"
        [[ "${configured_host}" == 'postgres' ]] \
            || die 'managed 模式要求 database.env 中 POSTGRES_HOST=postgres'
    fi
}

ensure_platform_env() {
    local key
    local -a required_keys=(
        REDIS_HOST REDIS_PORT REDIS_PASSWORD
        RABBITMQ_HOST RABBITMQ_PORT RABBITMQ_DEFAULT_USER
        RABBITMQ_DEFAULT_PASS RABBITMQ_DEFAULT_VHOST RABBITMQ_TASK_QUEUE
        AI_SERVICE_URL QDRANT_URL QDRANT_COLLECTION
        MINIO_ENDPOINT MINIO_ROOT_USER MINIO_ROOT_PASSWORD MINIO_BUCKET MINIO_USE_SSL
        JWT_SECRET JWT_ISSUER JWT_AUDIENCE JWT_COOKIE_NAME JWT_EXPIRES_SECONDS COOKIE_SECURE
    )

    [[ -f "${PLATFORM_ENV_FILE}" ]] || die "找不到平台配置：${PLATFORM_ENV_FILE}"
    [[ -r "${PLATFORM_ENV_FILE}" ]] || die "当前用户无法读取平台配置：${PLATFORM_ENV_FILE}"
    for key in "${required_keys[@]}"; do
        grep -Eq "^[[:space:]]*${key}=.+$" "${PLATFORM_ENV_FILE}" \
            || die "${PLATFORM_ENV_FILE} 缺少 ${key}"
    done
    grep -Eqi 'change_me|请替换|实际密码|your_password' "${PLATFORM_ENV_FILE}" \
        && die "${PLATFORM_ENV_FILE} 仍包含示例占位值，请先填写真实配置"

    ensure_llm_env
}

ensure_llm_env() {
    local key
    local -a required_keys=(
        DEEPSEEK_API_KEY DEEPSEEK_BASE_URL DEEPSEEK_MODEL
        QWEN_API_KEY QWEN_BASE_URL QWEN_MODEL
        LLM_REQUEST_TIMEOUT_SECONDS LLM_MAX_TOKENS
    )

    [[ -f "${LLM_ENV_FILE}" ]] || die "找不到独立大模型配置：${LLM_ENV_FILE}"
    [[ -r "${LLM_ENV_FILE}" ]] || die "当前用户无法读取大模型配置：${LLM_ENV_FILE}"
    for key in "${required_keys[@]}"; do
        grep -Eq "^[[:space:]]*${key}=.+$" "${LLM_ENV_FILE}" \
            || die "${LLM_ENV_FILE} 缺少 ${key}"
    done
    grep -Eqi 'change_me|请替换|你的工作空间|your[_-]?api|sk-xxx' "${LLM_ENV_FILE}" \
        && die "${LLM_ENV_FILE} 仍包含示例占位值，请先填写真实配置"
}

compose() {
    if [[ "${DATABASE_MODE}" == 'managed' ]]; then
        DATABASE_ENV_FILE="${DATABASE_ENV_FILE}" PLATFORM_ENV_FILE="${PLATFORM_ENV_FILE}" \
            docker compose -f "${COMPOSE_FILE}" --profile managed-db "$@"
    else
        DATABASE_ENV_FILE="${DATABASE_ENV_FILE}" PLATFORM_ENV_FILE="${PLATFORM_ENV_FILE}" \
            docker compose -f "${COMPOSE_FILE}" "$@"
    fi
}

acquire_deploy_lock() {
    mkdir -p "${DEPLOY_STATE_DIR}"
    if ! mkdir "${DEPLOY_LOCK_DIR}" 2>/dev/null; then
        die "已有部署任务正在运行；若确认没有任务，请删除 ${DEPLOY_LOCK_DIR}"
    fi
    trap 'rmdir "${DEPLOY_LOCK_DIR}" 2>/dev/null || true' EXIT
}

wait_for_healthy() {
    local service="$1"
    local attempts="${2:-60}"
    local container_id status index

    for ((index = 1; index <= attempts; index++)); do
        container_id="$(compose ps -q "${service}" 2>/dev/null || true)"
        if [[ -n "${container_id}" ]]; then
            status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
            if [[ "${status}" == 'healthy' || "${status}" == 'running' ]]; then
                log "容器已就绪：${service}"
                return 0
            fi
            if [[ "${status}" == 'unhealthy' || "${status}" == 'exited' || "${status}" == 'dead' ]]; then
                compose logs --tail=100 "${service}" >&2 || true
                die "容器启动失败：${service}（${status}）"
            fi
        fi
        sleep 2
    done

    compose logs --tail=100 "${service}" >&2 || true
    die "等待容器就绪超时：${service}"
}

start_database_if_managed() {
    if [[ "${DATABASE_MODE}" == 'managed' ]]; then
        log '启动项目托管的 PostgreSQL 容器'
        compose up -d postgres
        wait_for_healthy postgres
    else
        log '使用外部 PostgreSQL；不会启动或修改本项目的数据库容器'
    fi
}

start_infrastructure() {
    log '启动 Redis、RabbitMQ、Qdrant 和 MinIO'
    compose up -d "${INFRASTRUCTURE_SERVICES[@]}"
    wait_for_healthy redis
    wait_for_healthy rabbitmq
    log '创建或确认 MinIO 结果桶'
    compose run --rm minio-init
}

run_migrations() {
    ensure_database_env
    log '执行幂等数据库迁移'
    compose run --rm migrator
}

ensure_clean_worktree() {
    local changes
    changes="$(git -C "${REPO_ROOT}" status --porcelain --untracked-files=normal)"
    if [[ -n "${changes}" ]]; then
        printf '%s\n' "${changes}" >&2
        die '仓库存在本地修改；脚本不会覆盖，请先查明并提交、暂存或清理'
    fi
}

record_deploy_state() {
    local commit="$1"
    local branch="$2"

    mkdir -p "${DEPLOY_STATE_DIR}"
    printf '%s\n' "${commit}" >"${DEPLOY_STATE_DIR}/previous_commit"
    printf '%s\n' "${branch}" >"${DEPLOY_STATE_DIR}/production_branch"
}

pull_code() {
    local requested_branch="${1:-}"
    local target_branch old_commit old_branch new_commit

    ensure_repository
    ensure_clean_worktree

    old_commit="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
    old_branch="$(git -C "${REPO_ROOT}" branch --show-current)"
    target_branch="${requested_branch:-${DEPLOY_BRANCH:-${old_branch}}}"
    [[ -n "${target_branch}" ]] || die '无法确定部署分支，请传入分支名或设置 DEPLOY_BRANCH'
    record_deploy_state "${old_commit}" "${old_branch:-${target_branch}}"

    log "从 origin 拉取分支：${target_branch}"
    git -C "${REPO_ROOT}" fetch origin "${target_branch}"
    if git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${target_branch}"; then
        git -C "${REPO_ROOT}" switch "${target_branch}"
    else
        git -C "${REPO_ROOT}" switch --track -c "${target_branch}" "origin/${target_branch}"
    fi
    git -C "${REPO_ROOT}" pull --ff-only origin "${target_branch}"

    new_commit="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
    printf '更新前：%s\n更新后：%s\n' "${old_commit}" "${new_commit}"
    git -C "${REPO_ROOT}" diff --name-only "${old_commit}" "${new_commit}"
}

wait_http() {
    local url="$1"
    local description="$2"
    local attempts="${3:-30}"
    local index

    for ((index = 1; index <= attempts; index++)); do
        if compose exec -T nginx wget -qO- -T 5 "${url}" >/dev/null 2>&1; then
            log "验收通过：${description}"
            return 0
        fi
        sleep 2
    done
    compose logs --tail=100 >&2 || true
    die "验收失败：${description}（${url}）"
}

wait_internal_http() {
    local service="$1"
    local command="$2"
    local description="$3"
    local attempts="${4:-30}"
    local index

    for ((index = 1; index <= attempts; index++)); do
        if compose exec -T "${service}" sh -ec "${command}" >/dev/null 2>&1; then
            log "验收通过：${description}"
            return 0
        fi
        sleep 2
    done
    compose logs --tail=100 "${service}" >&2 || true
    die "验收失败：${description}"
}

verify_service() {
    case "$1" in
        frontend) wait_http 'http://127.0.0.1/' 'React 前端' ;;
        fastapi-service) wait_internal_http fastapi-service "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)\"" 'FastAPI AI 服务' ;;
        gin-service) wait_http 'http://127.0.0.1/realtime/health' 'Gin 实时服务' ;;
        nest-service) wait_http 'http://127.0.0.1/api/health' 'NestJS 核心后端' ;;
        worker) wait_internal_http worker "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=3)\"" '异步 Worker' ;;
        nginx) wait_http 'http://127.0.0.1/healthz' 'Nginx 统一入口' ;;
        *) die "不支持的服务：$1" ;;
    esac
}

validate_service() {
    case "$1" in
        frontend|fastapi-service|gin-service|nest-service|worker|nginx) ;;
        *) die "不支持的服务：$1" ;;
    esac
}

is_backend_service() {
    case "$1" in
        fastapi-service|gin-service|nest-service|worker) return 0 ;;
        *) return 1 ;;
    esac
}

uses_database() {
    case "$1" in
        nest-service|worker) return 0 ;;
        *) return 1 ;;
    esac
}

refresh_nginx() {
    # Nginx 在启动时解析上游容器地址，后端重建后需重启以刷新地址。
    compose up -d --no-deps nginx
    compose restart nginx
    wait_for_healthy nginx
}

update_one_service() {
    local service="$1"

    validate_service "${service}"
    ensure_repository
    ensure_docker_compose
    ensure_database_env
    ensure_platform_env
    compose config --quiet

    if is_backend_service "${service}"; then
        start_infrastructure
    fi
    if uses_database "${service}"; then
        start_database_if_managed
        run_migrations
    fi

    if [[ "${service}" == 'nginx' ]]; then
        log '检查并重新加载 Nginx 配置'
        compose exec -T nginx nginx -t
        compose up -d --no-deps --force-recreate nginx
        wait_for_healthy nginx
    else
        log "只构建并重建 ${service}"
        compose build "${service}"
        compose up -d --no-deps --force-recreate "${service}"
        wait_for_healthy "${service}"
        refresh_nginx
    fi

    compose ps
    verify_service "${service}"
}

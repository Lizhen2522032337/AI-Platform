#!/usr/bin/env bash

# 所有部署脚本共用的安全函数。该文件只应被其他脚本 source，不应单独执行。
set -Eeuo pipefail

readonly COMMON_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR="$(cd -- "${COMMON_DIR}/.." && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
readonly COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.yml"
readonly ENV_FILE="${REPO_ROOT}/deploy/.env"
readonly MIGRATIONS_DIR="${REPO_ROOT}/database/migrations"
readonly STATE_DIR="${REPO_ROOT}/deploy/.state"

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
    git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
        || die "${REPO_ROOT} 不是 Git 仓库"
    [[ -f "${COMPOSE_FILE}" ]] || die "找不到 ${COMPOSE_FILE}"
}

ensure_docker_compose() {
    require_command docker
    docker compose version >/dev/null 2>&1 || die "未安装 Docker Compose v2 插件"
    docker info >/dev/null 2>&1 || die "当前用户无法连接 Docker，请检查 Docker 服务和用户权限"
}

ensure_env_file() {
    [[ -f "${ENV_FILE}" ]] || die "找不到 deploy/.env，请先执行 first-deploy.sh 或根据 deploy/.env.example 创建"
    chmod 600 "${ENV_FILE}"
}

compose() {
    docker compose -f "${COMPOSE_FILE}" "$@"
}

run_privileged() {
    if [[ ${EUID} -eq 0 ]]; then
        "$@"
    else
        require_command sudo
        sudo "$@"
    fi
}

run_as_postgres() {
    if [[ ${EUID} -eq 0 ]]; then
        require_command runuser
        runuser -u postgres -- "$@"
    else
        require_command sudo
        sudo -u postgres "$@"
    fi
}

read_env_value() {
    local key="$1"
    local default_value="${2:-}"
    local value

    value="$(sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1)"
    if [[ -z "${value}" ]]; then
        printf '%s' "${default_value}"
    else
        printf '%s' "${value}"
    fi
}

ensure_clean_worktree() {
    local changes
    changes="$(git -C "${REPO_ROOT}" status --porcelain --untracked-files=normal)"
    if [[ -n "${changes}" ]]; then
        printf '%s\n' "${changes}" >&2
        die "仓库存在本地修改，请先查明来源；脚本不会自动覆盖"
    fi
}

record_deploy_state() {
    local commit="$1"
    local branch="$2"

    mkdir -p "${STATE_DIR}"
    printf '%s\n' "${commit}" >"${STATE_DIR}/previous_commit"
    printf '%s\n' "${branch}" >"${STATE_DIR}/production_branch"
}

run_migrations() {
    local db_name
    local migration

    ensure_env_file
    require_command psql
    db_name="$(read_env_value POSTGRES_DB enterprise_ai_platform)"
    [[ "${db_name}" =~ ^[A-Za-z0-9_]+$ ]] || die "POSTGRES_DB 只能包含字母、数字和下划线"
    [[ -d "${MIGRATIONS_DIR}" ]] || die "找不到数据库迁移目录"

    log "开始执行数据库迁移"
    while IFS= read -r -d '' migration; do
        log "执行迁移：$(basename "${migration}")"
        run_as_postgres psql -v ON_ERROR_STOP=1 -d "${db_name}" -f "${migration}"
    done < <(find "${MIGRATIONS_DIR}" -maxdepth 1 -type f -name '*.sql' -print0 | sort -z)
}

wait_http() {
    local url="$1"
    local description="$2"
    local attempts="${3:-30}"
    local index

    require_command curl
    for ((index = 1; index <= attempts; index++)); do
        if curl --fail --silent --show-error --max-time 5 "${url}" >/dev/null 2>&1; then
            log "验收通过：${description} (${url})"
            return 0
        fi
        sleep 2
    done
    die "验收失败：${description} (${url})"
}

verify_service() {
    case "$1" in
        frontend) wait_http 'http://127.0.0.1/' 'React 前端' ;;
        fastapi-service) wait_http 'http://127.0.0.1/api/fastapi/health' 'FastAPI 健康检查' ;;
        gin-service) wait_http 'http://127.0.0.1/api/gin/health' 'Gin 健康检查' ;;
        nest-service) wait_http 'http://127.0.0.1/api/nest/health' 'NestJS 健康检查' ;;
        nginx) wait_http 'http://127.0.0.1/' 'Nginx 统一入口' ;;
        *) die "不支持的服务：$1" ;;
    esac
}

validate_service() {
    case "$1" in
        frontend|fastapi-service|gin-service|nest-service|nginx) ;;
        *) die "不支持的服务：$1" ;;
    esac
}

is_backend_service() {
    case "$1" in
        fastapi-service|gin-service|nest-service) return 0 ;;
        *) return 1 ;;
    esac
}

update_one_service() {
    local service="$1"

    validate_service "${service}"
    ensure_repository
    ensure_docker_compose
    ensure_env_file
    compose config --quiet

    if is_backend_service "${service}"; then
        run_migrations
    fi

    if [[ "${service}" == 'nginx' ]]; then
        log '检查 Nginx 配置'
        compose run --rm --no-deps nginx nginx -t
        compose up -d --no-deps --force-recreate nginx
    else
        log "构建 ${service}"
        compose build "${service}"
        log "重建 ${service}"
        compose up -d --no-deps "${service}"
        # Nginx 启动时会解析容器地址，服务容器重建后需要刷新解析结果。
        compose restart nginx
    fi

    compose ps
    verify_service "${service}"
}

#!/usr/bin/env bash

# 所有 Linux 部署脚本共用的安全函数。本文件只应被其他脚本 source。
set -Eeuo pipefail

readonly COMMON_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR="$(cd -- "${COMMON_DIR}/.." && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

# 非敏感部署参数和数据库凭据都放在 Git 仓库之外，重新克隆代码不会覆盖它们。
DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE:-/etc/enterprise-ai-platform/deploy.env}"
if [[ -f "${DEPLOY_CONFIG_FILE}" ]]; then
    # shellcheck disable=SC1090
    source "${DEPLOY_CONFIG_FILE}"
fi

readonly COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.yml"
readonly MIGRATIONS_DIR="${REPO_ROOT}/database/migrations"
readonly DATABASE_ENV_FILE="${DATABASE_ENV_FILE:-/etc/enterprise-ai-platform/database.env}"
readonly DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-${HOME}/.local/state/enterprise-ai-platform}"
readonly POSTGRES_CLIENT_IMAGE="${POSTGRES_CLIENT_IMAGE:-postgres:16-alpine}"
export DATABASE_ENV_FILE

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

run_privileged() {
    if [[ ${EUID} -eq 0 ]]; then
        "$@"
    else
        require_command sudo
        sudo "$@"
    fi
}

ensure_repository() {
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
    [[ -f "${DATABASE_ENV_FILE}" ]] \
        || die "找不到独立数据库连接配置：${DATABASE_ENV_FILE}；请在部署应用前准备好该文件"
    [[ -r "${DATABASE_ENV_FILE}" ]] \
        || die "当前用户无法读取数据库连接配置：${DATABASE_ENV_FILE}"
}

compose() {
    DATABASE_ENV_FILE="${DATABASE_ENV_FILE}" docker compose -f "${COMPOSE_FILE}" "$@"
}

ensure_clean_worktree() {
    local changes
    changes="$(git -C "${REPO_ROOT}" status --porcelain --untracked-files=normal)"
    if [[ -n "${changes}" ]]; then
        printf '%s\n' "${changes}" >&2
        die '仓库存在本地修改；脚本不会自动覆盖，请先查明来源并提交、暂存或清理'
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
    require_command git
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

run_migrations() {
    local migration_mount

    ensure_database_env
    [[ -d "${MIGRATIONS_DIR}" ]] || die "找不到数据库迁移目录：${MIGRATIONS_DIR}"
    migration_mount="${MIGRATIONS_DIR}:/migrations:ro"

    log "使用 ${DATABASE_ENV_FILE} 连接数据库并执行迁移"
    docker run --rm \
        --env-file "${DATABASE_ENV_FILE}" \
        --add-host 'host.docker.internal:host-gateway' \
        --volume "${migration_mount}" \
        "${POSTGRES_CLIENT_IMAGE}" \
        sh -ec '
            export PGHOST="$POSTGRES_HOST"
            export PGPORT="${POSTGRES_PORT:-5432}"
            export PGDATABASE="$POSTGRES_DB"
            export PGUSER="$POSTGRES_USER"
            export PGPASSWORD="$POSTGRES_PASSWORD"
            export PGSSLMODE="${POSTGRES_SSLMODE:-disable}"
            found=0
            for migration in /migrations/*.sql; do
                [ -f "$migration" ] || continue
                found=1
                echo "执行迁移：$(basename "$migration")"
                psql -v ON_ERROR_STOP=1 -f "$migration"
            done
            [ "$found" -eq 1 ] || { echo "没有找到 SQL 迁移文件" >&2; exit 1; }
        '
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
    compose logs --tail=100 >&2 || true
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
    ensure_database_env
    compose config --quiet

    if is_backend_service "${service}"; then
        run_migrations
    fi

    if [[ "${service}" == 'nginx' ]]; then
        log '检查 Nginx 配置'
        compose run --rm --no-deps nginx nginx -t
        compose up -d --no-deps --force-recreate nginx
    else
        log "只构建并重建 ${service}"
        compose build "${service}"
        compose up -d --no-deps "${service}"
        # 服务容器地址可能变化，重启 Nginx 以刷新上游解析结果。
        compose restart nginx
    fi

    compose ps
    verify_service "${service}"
}

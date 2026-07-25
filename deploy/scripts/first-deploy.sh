#!/usr/bin/env bash

# 已克隆仓库的首次完整部署：创建独立数据库配置、迁移、构建、启动和验收。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

prompt_value() {
    local variable_name="$1"
    local prompt_text="$2"
    local default_value="$3"
    local current_value="${!variable_name:-}"

    if [[ -n "${current_value}" ]]; then
        printf -v "${variable_name}" '%s' "${current_value}"
        return
    fi
    read -r -p "${prompt_text} [${default_value}]: " current_value
    printf -v "${variable_name}" '%s' "${current_value:-${default_value}}"
}

create_database_env() {
    local config_dir legacy_env
    config_dir="$(dirname -- "${DATABASE_ENV_FILE}")"

    if [[ -f "${DATABASE_ENV_FILE}" ]]; then
        log "保留现有独立数据库配置：${DATABASE_ENV_FILE}"
        chmod 600 "${DATABASE_ENV_FILE}" 2>/dev/null || true
        legacy_env="${REPO_ROOT}/deploy/.env"
        [[ -e "${legacy_env}" ]] || ln -s "${DATABASE_ENV_FILE}" "${legacy_env}"
        return
    fi

    if [[ -t 0 ]]; then
        prompt_value POSTGRES_HOST '数据库地址' 'host.docker.internal'
        prompt_value POSTGRES_PORT '数据库端口' '5432'
        prompt_value POSTGRES_DB '数据库名称' 'enterprise_ai_platform'
        prompt_value POSTGRES_USER '数据库用户' 'postgres'
        read -r -s -p '数据库密码: ' POSTGRES_PASSWORD
        printf '\n'
        prompt_value POSTGRES_SSLMODE 'SSL 模式' 'disable'
    else
        POSTGRES_HOST="${POSTGRES_HOST:-host.docker.internal}"
        POSTGRES_PORT="${POSTGRES_PORT:-5432}"
        POSTGRES_DB="${POSTGRES_DB:-enterprise_ai_platform}"
        POSTGRES_USER="${POSTGRES_USER:-postgres}"
        POSTGRES_SSLMODE="${POSTGRES_SSLMODE:-disable}"
    fi

    [[ -n "${POSTGRES_PASSWORD:-}" ]] \
        || die '数据库配置不存在；非交互执行时必须传入 POSTGRES_PASSWORD'
    [[ "${POSTGRES_PASSWORD}" != *$'\n'* ]] || die '数据库密码不能包含换行符'

    run_privileged install -d -m 700 -o "$(id -un)" -g "$(id -gn)" "${config_dir}"
    umask 077
    {
        printf 'POSTGRES_HOST=%s\n' "${POSTGRES_HOST}"
        printf 'POSTGRES_PORT=%s\n' "${POSTGRES_PORT}"
        printf 'POSTGRES_DB=%s\n' "${POSTGRES_DB}"
        printf 'POSTGRES_USER=%s\n' "${POSTGRES_USER}"
        printf 'POSTGRES_PASSWORD=%s\n' "${POSTGRES_PASSWORD}"
        printf 'POSTGRES_SSLMODE=%s\n' "${POSTGRES_SSLMODE}"
    } >"${DATABASE_ENV_FILE}"
    chmod 600 "${DATABASE_ENV_FILE}"
    # 保留一个被 Git 忽略的兼容链接，便于回滚到仍读取 deploy/.env 的旧提交。
    legacy_env="${REPO_ROOT}/deploy/.env"
    [[ -e "${legacy_env}" ]] || ln -s "${DATABASE_ENV_FILE}" "${legacy_env}"
    unset POSTGRES_PASSWORD
    log "已创建独立数据库配置：${DATABASE_ENV_FILE}"
}

main() {
    ensure_repository
    ensure_docker_compose
    create_database_env
    ensure_database_env
    compose config --quiet
    run_migrations

    log '构建全部服务镜像'
    compose build --pull
    log '启动全部服务'
    compose up -d --remove-orphans
    "${SCRIPT_DIR}/verify.sh"
    log "首次部署完成，当前提交：$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
}

main "$@"

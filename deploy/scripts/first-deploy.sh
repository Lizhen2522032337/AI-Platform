#!/usr/bin/env bash

# 已克隆仓库的完整首次部署：配置数据库访问、创建环境文件、迁移、构建、启动和验收。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

create_env_file() {
    local db_password="${POSTGRES_PASSWORD:-}"

    if [[ -f "${ENV_FILE}" ]]; then
        log 'deploy/.env 已存在，将保留现有配置'
        chmod 600 "${ENV_FILE}"
        return
    fi

    if [[ -z "${db_password}" ]]; then
        [[ -t 0 ]] || die '非交互执行时必须通过 POSTGRES_PASSWORD 环境变量提供数据库密码'
        read -r -s -p '请输入 PostgreSQL postgres 用户密码：' db_password
        printf '\n'
    fi
    [[ -n "${db_password}" ]] || die '数据库密码不能为空'
    [[ "${db_password}" != *$'\n'* ]] || die '数据库密码不能包含换行符'

    umask 077
    {
        printf 'POSTGRES_HOST=host.docker.internal\n'
        printf 'POSTGRES_PORT=5432\n'
        printf 'POSTGRES_DB=enterprise_ai_platform\n'
        printf 'POSTGRES_USER=postgres\n'
        printf 'POSTGRES_PASSWORD=%s\n' "${db_password}"
        printf 'POSTGRES_SSLMODE=disable\n'
    } >"${ENV_FILE}"
    chmod 600 "${ENV_FILE}"
    unset db_password POSTGRES_PASSWORD
    log '已创建 deploy/.env，并设置权限为 600'
}

create_database_if_missing() {
    local db_name
    db_name="$(read_env_value POSTGRES_DB enterprise_ai_platform)"
    [[ "${db_name}" =~ ^[A-Za-z0-9_]+$ ]] || die "POSTGRES_DB 只能包含字母、数字和下划线"

    if [[ "$(run_as_postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'")" != '1' ]]; then
        log "创建数据库：${db_name}"
        run_as_postgres createdb "${db_name}"
    else
        log "数据库 ${db_name} 已存在"
    fi
}

configure_postgres_network() {
    local db_name db_user hba_file hba_rule service_unit unit_line units_output
    db_name="$(read_env_value POSTGRES_DB enterprise_ai_platform)"
    db_user="$(read_env_value POSTGRES_USER postgres)"
    hba_file="$(run_as_postgres psql -tAc 'SHOW hba_file;' | xargs)"
    [[ -n "${hba_file}" ]] || die '无法确定 pg_hba.conf 路径'

    log '配置 PostgreSQL 监听 Docker 宿主机网关'
    run_as_postgres psql -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET listen_addresses = '*';"

    hba_rule="host    ${db_name}    ${db_user}    172.16.0.0/12    scram-sha-256"
    if ! run_privileged grep -Fqx "${hba_rule}" "${hba_file}"; then
        run_privileged cp -a "${hba_file}" "${hba_file}.bak.$(date '+%Y%m%d%H%M%S')"
        printf '\n# Enterprise AI Platform Docker 网段\n%s\n' "${hba_rule}" \
            | run_privileged tee -a "${hba_file}" >/dev/null
    fi

    units_output="$(systemctl list-unit-files --type=service --no-legend 2>/dev/null)" \
        || die '无法读取 systemd 服务列表'
    service_unit=''
    while IFS= read -r unit_line; do
        unit_line="${unit_line%%[[:space:]]*}"
        if [[ "${unit_line}" =~ ^postgresql.*\.service$ ]]; then
            service_unit="${unit_line}"
            [[ "${service_unit}" == 'postgresql.service' ]] && break
        fi
    done <<<"${units_output}"
    [[ -n "${service_unit}" ]] || die '没有找到 PostgreSQL systemd 服务，请手动重启 PostgreSQL 后重新运行'
    run_privileged systemctl restart "${service_unit}"
    log "已重启 PostgreSQL：${service_unit}"

    if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
        run_privileged firewall-cmd --permanent \
            --add-rich-rule='rule family="ipv4" source address="172.16.0.0/12" port protocol="tcp" port="5432" accept'
        run_privileged firewall-cmd --reload
        log '已允许 Docker 私有网段访问 PostgreSQL 5432 端口'
    fi
}

main() {
    ensure_repository
    ensure_docker_compose
    require_command git
    require_command psql
    require_command systemctl
    create_env_file
    create_database_if_missing
    configure_postgres_network
    run_migrations

    compose config --quiet
    log '构建全部服务镜像'
    compose build --pull
    log '启动全部服务'
    compose up -d --remove-orphans
    "${SCRIPT_DIR}/verify.sh"
    log "首次部署完成，当前提交：$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
}

main "$@"

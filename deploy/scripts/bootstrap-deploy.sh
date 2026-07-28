#!/usr/bin/env bash

# 空白虚拟机上的首次部署入口：创建外部配置目录、克隆 Git 分支并执行完整部署。
set -Eeuo pipefail

readonly REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/Lizhen2522032337/AI-Platform.git}"
readonly DEPLOY_DIR="${DEPLOY_DIR:-/opt/enterprise-ai-platform}"
readonly CONFIG_DIR="${CONFIG_DIR:-/etc/enterprise-ai-platform}"
readonly BRANCH="${1:-${DEPLOY_BRANCH:-agent/initial-project}}"
readonly DATABASE_CONFIG="${DATABASE_ENV_FILE:-${CONFIG_DIR}/database.env}"
readonly PLATFORM_CONFIG="${PLATFORM_ENV_FILE:-${CONFIG_DIR}/platform.env}"
readonly LLM_CONFIG="${LLM_ENV_FILE:-${CONFIG_DIR}/llm.env}"
readonly DATABASE_MODE_VALUE="${DATABASE_MODE:-managed}"

log() {
    printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

die() {
    printf '[%s] 错误：%s\n' "$(date '+%F %T')" "$*" >&2
    exit 1
}

command -v git >/dev/null 2>&1 || die '缺少 git 命令'
command -v docker >/dev/null 2>&1 || die '缺少 Docker Engine，请先按部署文档安装'
docker compose version >/dev/null 2>&1 || die '缺少 Docker Compose v2 插件'
docker info >/dev/null 2>&1 || die '当前用户无法连接 Docker，请重新登录后检查 docker 用户组'
command -v sudo >/dev/null 2>&1 || [[ ${EUID} -eq 0 ]] || die '缺少 sudo 命令'
[[ "${DATABASE_MODE_VALUE}" == 'managed' || "${DATABASE_MODE_VALUE}" == 'external' ]] \
    || die 'DATABASE_MODE 只能是 managed 或 external'

if [[ -e "${DEPLOY_DIR}" ]] && [[ -n "$(find "${DEPLOY_DIR}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    die "${DEPLOY_DIR} 不是空目录；为保护现有文件，脚本已停止"
fi

if [[ ${EUID} -eq 0 ]]; then
    install -d -m 755 "${DEPLOY_DIR}"
    install -d -m 700 "${CONFIG_DIR}"
else
    sudo install -d -m 755 -o "$(id -un)" -g "$(id -gn)" "${DEPLOY_DIR}"
    sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" "${CONFIG_DIR}"
fi

# 数据库、平台和大模型配置必须由用户预先准备；脚本不会生成或输出真实密码或 API Key。
[[ -f "${DATABASE_CONFIG}" ]] \
    || die "找不到 ${DATABASE_CONFIG}；请先按部署手册准备数据库连接文件"
[[ -r "${DATABASE_CONFIG}" ]] \
    || die "当前用户无法读取 ${DATABASE_CONFIG}"
[[ -f "${PLATFORM_CONFIG}" ]] \
    || die "找不到 ${PLATFORM_CONFIG}；请先按部署手册准备平台连接配置"
[[ -r "${PLATFORM_CONFIG}" ]] \
    || die "当前用户无法读取 ${PLATFORM_CONFIG}"
[[ -f "${LLM_CONFIG}" ]] \
    || die "找不到 ${LLM_CONFIG}；请先按部署手册准备 DeepSeek/千问配置"
[[ -r "${LLM_CONFIG}" ]] \
    || die "当前用户无法读取 ${LLM_CONFIG}"

umask 077
{
    printf 'DEPLOY_BRANCH=%q\n' "${BRANCH}"
    printf 'DATABASE_ENV_FILE=%q\n' "${DATABASE_CONFIG}"
    printf 'PLATFORM_ENV_FILE=%q\n' "${PLATFORM_CONFIG}"
    printf 'LLM_ENV_FILE=%q\n' "${LLM_CONFIG}"
    printf 'DATABASE_MODE=%q\n' "${DATABASE_MODE_VALUE}"
} >"${CONFIG_DIR}/deploy.env"

log "克隆 ${BRANCH} 到 ${DEPLOY_DIR}"
git clone --branch "${BRANCH}" --single-branch "${REPOSITORY_URL}" "${DEPLOY_DIR}"

log '开始首次完整部署'
exec "${DEPLOY_DIR}/deploy/scripts/first-deploy.sh"

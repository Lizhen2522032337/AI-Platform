#!/usr/bin/env bash

# 首次部署引导脚本：创建 /opt 目录、克隆指定分支，然后调用完整部署脚本。
set -Eeuo pipefail

readonly REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/Lizhen2522032337/AI-Platform.git}"
readonly DEPLOY_DIR="${DEPLOY_DIR:-/opt/enterprise-ai-platform}"
readonly BRANCH="${1:-master}"

log() {
    printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

die() {
    printf '[%s] 错误：%s\n' "$(date '+%F %T')" "$*" >&2
    exit 1
}

command -v git >/dev/null 2>&1 || die '缺少 git 命令'
command -v sudo >/dev/null 2>&1 || die '缺少 sudo 命令'

if [[ -e "${DEPLOY_DIR}" ]] && [[ -n "$(find "${DEPLOY_DIR}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    die "${DEPLOY_DIR} 不是空目录；为保护现有文件，脚本已停止"
fi

log "创建部署目录：${DEPLOY_DIR}"
sudo mkdir -p "${DEPLOY_DIR}"
sudo chown "$(id -u):$(id -g)" "${DEPLOY_DIR}"

log "克隆 ${BRANCH} 分支"
git clone --branch "${BRANCH}" --single-branch "${REPOSITORY_URL}" "${DEPLOY_DIR}"

log '开始执行完整首次部署'
exec "${DEPLOY_DIR}/deploy/scripts/first-deploy.sh"

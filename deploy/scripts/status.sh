#!/usr/bin/env bash

# 查看当前 Git 版本、容器状态、镜像和磁盘占用；不会修改任何运行状态。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

ensure_repository
ensure_docker_compose

echo '========== 部署配置 =========='
printf '仓库目录：%s\n' "${REPO_ROOT}"
printf '部署分支：%s\n' "${DEPLOY_BRANCH:-未配置}"
printf '数据库模式：%s\n' "${DATABASE_MODE}"
printf '数据库配置：%s\n' "${DATABASE_ENV_FILE}"
printf '平台配置：%s\n' "${PLATFORM_ENV_FILE}"
echo

echo '========== Git =========='
git -C "${REPO_ROOT}" status --short --branch
git -C "${REPO_ROOT}" log -1 --oneline
echo

echo '========== Docker Compose =========='
compose ps -a
echo

echo '========== 项目镜像 =========='
docker image ls --filter 'label=com.docker.compose.project=enterprise-ai-platform'
echo

echo '========== 磁盘 =========='
df -h "${REPO_ROOT}"

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
printf '基础镜像锁：%s\n' "${BASE_IMAGES_FILE}"
printf '应用镜像仓库：%s\n' "${APP_IMAGE_REGISTRY}"
echo

echo '========== Git =========='
git -C "${REPO_ROOT}" status --short --branch
git -C "${REPO_ROOT}" log -1 --oneline
echo

echo '========== 发布记录 =========='
if [[ -f "${DEPLOY_STATE_DIR}/current_release" ]]; then
    printf '当前完整发布：%s\n' "$(<"${DEPLOY_STATE_DIR}/current_release")"
else
    echo '当前完整发布：尚未记录'
fi
if [[ -f "${DEPLOY_STATE_DIR}/previous_release" ]]; then
    printf '可快速回滚到：%s\n' "$(<"${DEPLOY_STATE_DIR}/previous_release")"
else
    echo '可快速回滚到：尚未记录'
fi
if [[ -f "${DEPLOY_STATE_DIR}/release-history.tsv" ]]; then
    tail -n 10 "${DEPLOY_STATE_DIR}/release-history.tsv"
fi
echo

echo '========== Docker Compose =========='
compose ps -a
echo

echo '========== 项目镜像 =========='
for service in "${APPLICATION_SERVICES[@]}"; do
    container_id="$(compose ps -q "${service}" 2>/dev/null || true)"
    if [[ -n "${container_id}" ]]; then
        docker inspect --format '{{.Name}} -> {{.Config.Image}} [{{.Image}}]' "${container_id}"
    else
        printf '%s -> 未运行\n' "${service}"
    fi
done
echo

echo '========== 磁盘 =========='
df -h "${REPO_ROOT}"
docker system df
if docker buildx version >/dev/null 2>&1; then
    docker buildx du || true
fi

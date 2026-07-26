#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-enterprise-ai-platform}"
APP_ROOT="${APP_ROOT:-/opt/enterprise-ai-platform}"
DEPLOY_USER="${DEPLOY_USER:-eai}"
DEPLOY_GROUP="${DEPLOY_GROUP:-eai}"

[[ "$(id -u)" -eq 0 ]] || {
  echo "请使用 root 执行此脚本。"
  exit 1
}

echo "[1/8] 安装基础工具"
dnf install -y git openssh-clients tar gzip curl jq rsync util-linux-core

echo "[2/8] 检查 Docker"
command -v docker >/dev/null 2>&1 || {
  echo "未检测到 Docker。请先按 Docker 官方 CentOS 安装流程完成 Docker Engine 安装。"
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "未检测到 docker compose 插件。"
  exit 1
}

echo "[3/8] 创建部署用户"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi

echo "[4/8] 允许部署用户调用 Docker"
usermod -aG docker "$DEPLOY_USER"

echo "[5/8] 创建目录"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/repository"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/releases"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/shared"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/shared/state"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/shared/backups"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/shared/logs"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/shared/uploads"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/shared/postgres"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/shared/redis"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/shared/rabbitmq"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/shared/qdrant"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/shared/minio"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" "$APP_ROOT/bin"

echo "[6/8] 创建部署配置模板"
DEPLOY_CONF="$APP_ROOT/shared/deploy.conf"
if [[ ! -f "$DEPLOY_CONF" ]]; then
  cat > "$DEPLOY_CONF" <<EOF
APP_NAME=$APP_NAME
APP_ROOT=$APP_ROOT
REPO_DIR=$APP_ROOT/repository
RELEASES_DIR=$APP_ROOT/releases
SHARED_DIR=$APP_ROOT/shared
SHARED_ENV_FILE=$APP_ROOT/shared/.env.production
COMPOSE_RELATIVE_PATH=deploy/compose.prod.yml
COMPOSE_PROJECT_NAME=enterprise-ai
DEFAULT_BRANCH=main
HEALTHCHECK_URL=http://127.0.0.1/healthz
KEEP_RELEASES=5
CURRENT_LINK=$APP_ROOT/current
HISTORY_FILE=$APP_ROOT/shared/deployment-history.log
LOCK_FILE=$APP_ROOT/shared/deploy.lock
STATE_DIR=$APP_ROOT/shared/state
PULL_BASE_IMAGES=false
EOF
  chown "$DEPLOY_USER:$DEPLOY_GROUP" "$DEPLOY_CONF"
  chmod 0640 "$DEPLOY_CONF"
fi

echo "[7/8] 配置 SELinux 文件上下文"
if command -v semanage >/dev/null 2>&1; then
  semanage fcontext -a -t container_file_t "${APP_ROOT}/shared(/.*)?" 2>/dev/null || true
  restorecon -Rv "$APP_ROOT/shared" || true
else
  echo "[WARN] semanage 不存在。如遇挂载权限问题，可安装 policycoreutils-python-utils 后配置。"
fi

echo "[8/8] 完成"
echo "请退出当前终端并重新登录，使 docker 组权限生效："
echo "  exit"
echo "然后使用："
echo "  su - $DEPLOY_USER"
echo ""
echo "注意：docker 组拥有接近 root 的主机权限，只应授予受信任的部署用户。"

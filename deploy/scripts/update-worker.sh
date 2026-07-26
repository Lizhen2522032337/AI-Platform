#!/usr/bin/env bash

# 从 Git 拉取代码、执行数据库迁移后，只重建异步 Worker。
set -Eeuo pipefail
readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"
acquire_deploy_lock
pull_code "${1:-}"
update_one_service worker

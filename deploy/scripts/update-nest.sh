#!/usr/bin/env bash

# 从 Git 拉取代码、执行迁移后，只重建并更新 NestJS 服务。
set -Eeuo pipefail
readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"
pull_code "${1:-}"
update_one_service nest-service

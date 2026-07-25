#!/usr/bin/env bash

# 执行数据库迁移后，只重建并更新 NestJS 服务。
set -Eeuo pipefail
readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"
update_one_service nest-service

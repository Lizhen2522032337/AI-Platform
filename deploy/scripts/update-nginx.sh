#!/usr/bin/env bash

# 从 Git 拉取代码后，只校验并更新 Nginx 配置。
set -Eeuo pipefail
readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"
prepare_update "${BASH_SOURCE[0]}" "${1:-}" "$@"
update_one_service nginx

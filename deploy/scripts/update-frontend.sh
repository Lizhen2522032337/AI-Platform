#!/usr/bin/env bash

# 只重建并更新 React 前端。
set -Eeuo pipefail
readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"
update_one_service frontend

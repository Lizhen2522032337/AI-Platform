#!/usr/bin/env bash

# 只安全拉取 Git 代码；组件更新脚本会自动调用同一函数。
set -Eeuo pipefail

readonly CURRENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${CURRENT_DIR}/lib/common.sh"

pull_code "${1:-}"

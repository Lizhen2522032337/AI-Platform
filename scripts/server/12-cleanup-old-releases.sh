#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-common.sh
source "$SCRIPT_DIR/00-common.sh"

load_deploy_config

CURRENT_VERSION="$(current_version 2>/dev/null || true)"

mapfile -t releases < <(
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d \
    -printf '%T@ %f\n' |
    sort -nr |
    awk '{print $2}'
)

if (( ${#releases[@]} <= KEEP_RELEASES )); then
  log "当前版本目录数量 ${#releases[@]}，无需清理。"
  exit 0
fi

for ((i=KEEP_RELEASES; i<${#releases[@]}; i++)); do
  version="${releases[$i]}"

  if [[ "$version" == "$CURRENT_VERSION" ]]; then
    warn "跳过当前版本：$version"
    continue
  fi

  release_dir="$RELEASES_DIR/$version"
  log "移除旧版本工作目录：$release_dir"
  git -C "$REPO_DIR" worktree remove --force "$release_dir" ||
    rm -rf "$release_dir"
done

git -C "$REPO_DIR" worktree prune

log "清理悬空 Docker 镜像"
docker image prune -f

log "清理完成。保留最近 $KEEP_RELEASES 个版本目录。"

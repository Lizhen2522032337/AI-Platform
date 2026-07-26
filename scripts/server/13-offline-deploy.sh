#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=00-common.sh
source "$SCRIPT_DIR/00-common.sh"

ARCHIVE_PATH="${1:-}"
VERSION="${2:-}"

[[ -n "$ARCHIVE_PATH" && -n "$VERSION" ]] ||
  die "用法：$0 <发布包.tar.gz> <版本，例如 v1.0.0>"

load_deploy_config
validate_version "$VERSION"
require_file "$ARCHIVE_PATH"

exec 9>"$LOCK_FILE"
flock -n 9 || die "已有其他部署任务正在运行。"

if [[ -f "$ARCHIVE_PATH.sha256" ]]; then
  log "校验离线包 SHA256"
  (
    cd "$(dirname "$ARCHIVE_PATH")"
    sha256sum -c "$(basename "$ARCHIVE_PATH").sha256"
  )
else
  warn "没有找到 $ARCHIVE_PATH.sha256，无法验证传输完整性。"
fi

RELEASE_DIR="$(release_dir_for "$VERSION")"
[[ ! -e "$RELEASE_DIR" ]] || die "版本目录已存在：$RELEASE_DIR"

tmp_dir="$(mktemp -d "$RELEASES_DIR/.offline.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

tar -xzf "$ARCHIVE_PATH" -C "$tmp_dir"

mapfile -t extracted_dirs < <(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d)
(( ${#extracted_dirs[@]} == 1 )) ||
  die "离线包必须只包含一个顶层目录。"

mv "${extracted_dirs[0]}" "$RELEASE_DIR"
trap - EXIT
rm -rf "$tmp_dir"

export APP_VERSION="$VERSION"
compose "$RELEASE_DIR" config --quiet
compose "$RELEASE_DIR" build
compose "$RELEASE_DIR" up \
  -d \
  --no-build \
  --remove-orphans \
  --wait \
  --wait-timeout 240

"$SCRIPT_DIR/05-healthcheck.sh"
switch_current_link "$RELEASE_DIR"
record_history "OFFLINE_DEPLOY" "$VERSION" "offline-package"

log "离线部署完成：$VERSION"

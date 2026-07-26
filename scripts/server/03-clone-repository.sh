#!/usr/bin/env bash
set -Eeuo pipefail

GITHUB_OWNER="${1:-}"
GITHUB_REPO="${2:-}"
APP_ROOT="${APP_ROOT:-/opt/enterprise-ai-platform}"
REPO_DIR="$APP_ROOT/repository"

[[ -n "$GITHUB_OWNER" ]] || {
  echo "用法：$0 <GitHubOwner> <RepositoryName>"
  exit 1
}

[[ -n "$GITHUB_REPO" ]] || {
  echo "用法：$0 <GitHubOwner> <RepositoryName>"
  exit 1
}

ssh -T github-enterprise-ai 2>&1 | tee /tmp/github-ssh-test.log || true
grep -Eq "successfully authenticated|You've successfully authenticated" /tmp/github-ssh-test.log || {
  echo "GitHub SSH 验证失败。请确认 Deploy Key 已添加到正确仓库。"
  exit 1
}

if [[ -d "$REPO_DIR/.git" ]]; then
  echo "仓库已经存在：$REPO_DIR"
  git -C "$REPO_DIR" remote -v
  exit 0
fi

if [[ -d "$REPO_DIR" ]] && [[ -n "$(find "$REPO_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "目录非空但不是 Git 仓库：$REPO_DIR"
  exit 1
fi

rm -rf "$REPO_DIR"
git clone \
  "git@github-enterprise-ai:${GITHUB_OWNER}/${GITHUB_REPO}.git" \
  "$REPO_DIR"

git -C "$REPO_DIR" config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
git -C "$REPO_DIR" fetch --prune --tags origin

echo "[OK] 仓库已克隆：$REPO_DIR"
git -C "$REPO_DIR" remote -v
git -C "$REPO_DIR" tag --sort=-version:refname | head -n 20

#!/usr/bin/env bash
set -Eeuo pipefail

KEY_NAME="${KEY_NAME:-github_enterprise_ai_deploy}"
KEY_PATH="$HOME/.ssh/$KEY_NAME"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

if [[ -e "$KEY_PATH" || -e "$KEY_PATH.pub" ]]; then
  echo "密钥已存在：$KEY_PATH"
  echo "为避免覆盖，脚本已停止。"
  exit 1
fi

ssh-keygen \
  -t ed25519 \
  -C "$(hostname)-enterprise-ai-readonly-deploy" \
  -f "$KEY_PATH" \
  -N ""

chmod 600 "$KEY_PATH"
chmod 644 "$KEY_PATH.pub"

# 使用 GitHub 官方公布的 ED25519 主机公钥，避免第一次连接时盲目接受未知主机。
KNOWN_HOSTS="$HOME/.ssh/known_hosts"
touch "$KNOWN_HOSTS"
chmod 600 "$KNOWN_HOSTS"

GITHUB_ED25519_ENTRY='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
grep -Fqx "$GITHUB_ED25519_ENTRY" "$KNOWN_HOSTS" || echo "$GITHUB_ED25519_ENTRY" >> "$KNOWN_HOSTS"

SSH_CONFIG="$HOME/.ssh/config"
cat > "$SSH_CONFIG" <<EOF
Host github-enterprise-ai
    HostName github.com
    User git
    IdentityFile $KEY_PATH
    IdentitiesOnly yes
    StrictHostKeyChecking yes
EOF
chmod 600 "$SSH_CONFIG"

echo ""
echo "部署私钥：$KEY_PATH"
echo "部署公钥：$KEY_PATH.pub"
echo ""
echo "请将下面这一整行添加到 GitHub 仓库："
echo "Repository -> Settings -> Deploy keys -> Add deploy key"
echo "Title: $(hostname)-enterprise-ai-readonly"
echo "不要勾选 Allow write access。"
echo ""
cat "$KEY_PATH.pub"
echo ""
echo "添加完成后执行："
echo "  ssh -T github-enterprise-ai"

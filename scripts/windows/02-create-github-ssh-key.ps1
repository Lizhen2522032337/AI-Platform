[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Email,

    [string]$KeyName = "id_ed25519_github_enterprise_ai"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$sshDir = Join-Path $HOME ".ssh"
$keyPath = Join-Path $sshDir $KeyName
$publicKeyPath = "$keyPath.pub"

New-Item -ItemType Directory -Path $sshDir -Force | Out-Null

if (Test-Path -LiteralPath $keyPath) {
    throw "密钥已存在：$keyPath。为了避免覆盖，请修改 -KeyName，或先人工备份旧密钥。"
}

Write-Host "正在生成 ED25519 SSH 密钥..." -ForegroundColor Cyan
& ssh-keygen -t ed25519 -C $Email -f $keyPath
if ($LASTEXITCODE -ne 0) {
    throw "ssh-keygen 执行失败。"
}

# 尝试启动 Windows ssh-agent。若权限不足，用户仍可在 Git Bash 中使用密钥。
try {
    $service = Get-Service ssh-agent -ErrorAction Stop
    if ($service.StartType -eq "Disabled") {
        Set-Service -Name ssh-agent -StartupType Manual
    }
    if ($service.Status -ne "Running") {
        Start-Service ssh-agent
    }

    & ssh-add $keyPath
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] ssh-add 未成功，请稍后手动执行：ssh-add `"$keyPath`"" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "[WARN] 无法自动启动 ssh-agent。可以使用 Git Bash 执行 ssh-add，或在 ~/.ssh/config 中指定 IdentityFile。" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "私钥：$keyPath" -ForegroundColor Yellow
Write-Host "公钥：$publicKeyPath" -ForegroundColor Green
Write-Host ""
Write-Host "请复制下面这一整行公钥到 GitHub -> Settings -> SSH and GPG keys -> New SSH key：" -ForegroundColor Cyan
Get-Content -LiteralPath $publicKeyPath
Write-Host ""
Write-Host "重要：私钥绝对不要上传、提交或发给其他人。" -ForegroundColor Red

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Item {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    try {
        $value = & $Action
        Write-Host ("[OK] {0}: {1}" -f $Name, $value) -ForegroundColor Green
    }
    catch {
        Write-Host ("[FAIL] {0}: {1}" -f $Name, $_.Exception.Message) -ForegroundColor Red
        throw
    }
}

Write-Host "检查 Windows GitHub 开发环境..." -ForegroundColor Cyan

Show-Item "Git" {
    (git --version).Trim()
}

Show-Item "OpenSSH Client" {
    (ssh -V 2>&1 | Out-String).Trim()
}

Show-Item "当前目录" {
    (Get-Location).Path
}

$gitUserName = git config --global user.name
$gitUserEmail = git config --global user.email

if ([string]::IsNullOrWhiteSpace($gitUserName)) {
    Write-Host "[WARN] 尚未配置 git user.name" -ForegroundColor Yellow
}
else {
    Write-Host "[OK] Git user.name: $gitUserName" -ForegroundColor Green
}

if ([string]::IsNullOrWhiteSpace($gitUserEmail)) {
    Write-Host "[WARN] 尚未配置 git user.email" -ForegroundColor Yellow
}
else {
    Write-Host "[OK] Git user.email: $gitUserEmail" -ForegroundColor Green
}

$sshDir = Join-Path $HOME ".ssh"
if (-not (Test-Path -LiteralPath $sshDir)) {
    Write-Host "[WARN] $sshDir 不存在，后续生成 SSH 密钥时会自动创建。" -ForegroundColor Yellow
}
else {
    Write-Host "[OK] SSH 目录: $sshDir" -ForegroundColor Green
    Get-ChildItem -LiteralPath $sshDir -File -ErrorAction SilentlyContinue |
        Select-Object Name, Length, LastWriteTime |
        Format-Table -AutoSize
}

Write-Host ""
Write-Host "检查完成。" -ForegroundColor Cyan

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+([\-+][0-9A-Za-z\.\-]+)?$')]
    [string]$Version,

    [string]$Message = "",

    [switch]$SkipVerification
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = "Release $Version"
}

$status = git status --porcelain
if ($status) {
    Write-Host "以下文件尚未提交：" -ForegroundColor Yellow
    git status --short
    throw "发布前工作区必须保持干净。"
}

$currentBranch = (git branch --show-current).Trim()
if ($currentBranch -ne "main") {
    throw "只能从 main 分支发布。当前分支：$currentBranch"
}

git fetch origin --prune --tags
if ($LASTEXITCODE -ne 0) { throw "git fetch 失败。" }

git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "main 无法快进更新。请先解决分支差异。" }

$localCommit = (git rev-parse HEAD).Trim()
$remoteCommit = (git rev-parse origin/main).Trim()
if ($localCommit -ne $remoteCommit) {
    throw "本地 main 与 origin/main 不一致，禁止发布。"
}

$existingTag = git tag --list $Version
if ($existingTag) {
    throw "标签已存在：$Version。发布标签不应覆盖或复用。"
}

if (-not $SkipVerification) {
    if (Test-Path -LiteralPath "scripts/windows/verify-release.ps1") {
        & "scripts/windows/verify-release.ps1"
        if ($LASTEXITCODE -ne 0) {
            throw "发布验证脚本失败。"
        }
    }
    else {
        Write-Host "[WARN] 未发现 scripts/windows/verify-release.ps1，仅执行 Git 状态检查。" -ForegroundColor Yellow
    }
}

git tag -a $Version -m $Message
if ($LASTEXITCODE -ne 0) { throw "创建标签失败。" }

git push origin $Version
if ($LASTEXITCODE -ne 0) {
    git tag -d $Version | Out-Null
    throw "推送标签失败，本地标签已删除。"
}

Write-Host ""
Write-Host "[OK] 已发布 Git 标签：$Version" -ForegroundColor Green
Write-Host "提交：$localCommit"
Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "1. 在 GitHub 仓库页面进入 Releases。"
Write-Host "2. 选择 Draft a new release。"
Write-Host "3. 选择标签 $Version。"
Write-Host "4. 填写变更说明并发布。"
Write-Host "5. 登录 CentOS 执行：deploy.sh $Version"

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9][a-z0-9\-]*$')]
    [string]$FeatureName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$branchName = "feature/$FeatureName"

$status = git status --porcelain
if ($status) {
    throw "当前工作区有未提交修改。请先提交或暂存后再创建功能分支。"
}

git switch main
if ($LASTEXITCODE -ne 0) { throw "切换 main 失败。" }

git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "更新 main 失败。" }

git switch -c $branchName
if ($LASTEXITCODE -ne 0) { throw "创建分支失败：$branchName" }

git push -u origin $branchName
if ($LASTEXITCODE -ne 0) { throw "推送分支失败：$branchName" }

Write-Host "[OK] 已创建并推送：$branchName" -ForegroundColor Green

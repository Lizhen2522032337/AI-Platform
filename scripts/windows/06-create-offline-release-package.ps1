[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+([\-+][0-9A-Za-z\.\-]+)?$')]
    [string]$Version,

    [string]$ProjectRoot = (Get-Location).Path,

    [string]$OutputDirectory = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path (Split-Path -Parent $ProjectRoot) "_release"
}

$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$status = git -C $ProjectRoot status --porcelain
if ($status) {
    throw "工作区不干净，禁止生成正式离线发布包。"
}

git -C $ProjectRoot fetch origin --tags
if ($LASTEXITCODE -ne 0) { throw "git fetch 失败。" }

git -C $ProjectRoot rev-parse --verify "refs/tags/$Version" *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Git 标签不存在：$Version"
}

$projectName = Split-Path -Leaf $ProjectRoot
$archiveName = "$projectName-$Version.tar.gz"
$archivePath = Join-Path $OutputDirectory $archiveName
$shaPath = "$archivePath.sha256"

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

# git archive 只打包 Git 已跟踪文件，因此不会把 .env、node_modules、日志和运行数据带入发布包。
Push-Location $ProjectRoot
try {
    & git archive --format=tar --prefix="$projectName-$Version/" $Version |
        & tar.exe -czf $archivePath -T -
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $archivePath)) {
    throw "离线发布包生成失败。"
}

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath $shaPath -Value "$hash  $archiveName" -Encoding ASCII

Write-Host "[OK] 离线发布包：$archivePath" -ForegroundColor Green
Write-Host "[OK] SHA256 文件：$shaPath" -ForegroundColor Green
Write-Host "SHA256：$hash"

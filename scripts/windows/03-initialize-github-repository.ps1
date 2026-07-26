[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepositorySshUrl,

    [string]$ProjectRoot = (Get-Location).Path,

    [string]$InitialCommitMessage = "chore: initialize enterprise AI platform repository"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "项目目录不存在：$ProjectRoot"
}

Set-Location $ProjectRoot

if (-not (Test-Path -LiteralPath ".gitignore")) {
@'
# Environment and secrets
.env
.env.*
!.env.example
!.env.*.example
*.pem
*.key
*.p12
*.pfx
secrets/

# Node.js
node_modules/
dist/
build/
coverage/
.next/
.nuxt/
.turbo/
.cache/
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*

# Python
__pycache__/
*.py[cod]
.pytest_cache/
.mypy_cache/
.ruff_cache/
.venv/
venv/
env/

# Go
bin/
*.test
*.out

# IDE
.idea/
.vscode/
.vs/
*.user
*.suo

# Operating system
.DS_Store
Thumbs.db
desktop.ini

# Runtime data
logs/
log/
tmp/
temp/
uploads/
storage/
data/
postgres_data/
redis_data/
rabbitmq_data/
qdrant_storage/
minio_data/

# Release artifacts
_release/
releases/
*.tar
*.tar.gz
*.zip
*.sha256

# Certificates generated for local/private deployment
deploy/certs/*
!deploy/certs/.gitkeep
'@ | Set-Content -LiteralPath ".gitignore" -Encoding UTF8

    Write-Host "[OK] 已创建 .gitignore" -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath ".gitattributes")) {
@'
* text=auto

# Linux deployment scripts must keep LF line endings.
*.sh text eol=lf
Dockerfile text eol=lf
*.conf text eol=lf
*.yml text eol=lf
*.yaml text eol=lf

# Windows scripts use CRLF.
*.ps1 text eol=crlf
*.bat text eol=crlf
*.cmd text eol=crlf

# Binary files
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.pdf binary
*.docx binary
*.xlsx binary
*.zip binary
*.gz binary
'@ | Set-Content -LiteralPath ".gitattributes" -Encoding UTF8

    Write-Host "[OK] 已创建 .gitattributes" -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath ".git")) {
    git init -b main
    if ($LASTEXITCODE -ne 0) {
        throw "git init 失败。"
    }
}

$existingRemote = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0 -and $existingRemote) {
    if ($existingRemote.Trim() -ne $RepositorySshUrl) {
        Write-Host "[WARN] origin 已存在，正在更新为：$RepositorySshUrl" -ForegroundColor Yellow
        git remote set-url origin $RepositorySshUrl
    }
}
else {
    git remote add origin $RepositorySshUrl
}

# 检查是否错误提交了敏感文件。
$sensitiveFiles = Get-ChildItem -LiteralPath $ProjectRoot -Recurse -File -Force |
    Where-Object {
        $_.Name -eq ".env" -or
        $_.Name -like ".env.*" -and $_.Name -notlike "*.example" -or
        $_.Extension -in @(".pem", ".key", ".p12", ".pfx")
    }

if ($sensitiveFiles) {
    Write-Host "[WARN] 项目目录中发现潜在敏感文件。它们应被 .gitignore 排除：" -ForegroundColor Yellow
    $sensitiveFiles | ForEach-Object { Write-Host ("  - " + $_.FullName) }
}

git add .
if ($LASTEXITCODE -ne 0) {
    throw "git add 失败。"
}

$stagedFiles = git diff --cached --name-only
if (-not $stagedFiles) {
    Write-Host "[INFO] 没有需要提交的新文件。" -ForegroundColor Cyan
}
else {
    git commit -m $InitialCommitMessage
    if ($LASTEXITCODE -ne 0) {
        throw "git commit 失败。请先检查 user.name 和 user.email。"
    }
}

git branch -M main
git push -u origin main
if ($LASTEXITCODE -ne 0) {
    throw "推送 main 分支失败。请检查 GitHub 仓库地址和 SSH 权限。"
}

Write-Host ""
Write-Host "[OK] 项目已推送到 GitHub：$RepositorySshUrl" -ForegroundColor Green

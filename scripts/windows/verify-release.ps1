[CmdletBinding()]
param(
    [string]$ExpectedBranch = "main",
    [switch]$SkipGitStateCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 脚本固定放在 scripts/windows，因此向上两级即可得到仓库根目录。
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,

        [Parameter(Mandatory = $true)]
        [string]$Command,

        [string[]]$Arguments = @()
    )

    Write-Host "[RUN] $Name" -ForegroundColor Cyan
    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Name 失败，退出码：$LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
    Write-Host "[OK] $Name" -ForegroundColor Green
}

if (-not $SkipGitStateCheck) {
    # 正式发布必须来自固定分支和干净工作区，保证标签可以重复审计。
    $currentBranch = (git -C $ProjectRoot branch --show-current).Trim()
    if ($currentBranch -ne $ExpectedBranch) {
        throw "当前分支是 $currentBranch，正式发布要求分支：$ExpectedBranch"
    }

    $worktreeStatus = git -C $ProjectRoot status --porcelain
    if ($worktreeStatus) {
        throw "工作区存在未提交修改，不能执行正式发布验证。"
    }
}

# 检查 Git 已跟踪文件，防止真实环境文件、私钥或本地依赖进入发布版本。
$trackedRiskyFiles = git -C $ProjectRoot ls-files |
    Select-String -Pattern '(^|/)(\.env($|\.)|node_modules/|\.venv/|__pycache__/|\.pytest_cache/)|\.(pem|key|p12|pfx)$'
if ($trackedRiskyFiles) {
    $trackedRiskyFiles | ForEach-Object { Write-Host $_.Line -ForegroundColor Red }
    throw "Git 中存在不应进入发布版本的敏感文件或本地依赖。"
}
Write-Host "[OK] Git 跟踪文件安全检查" -ForegroundColor Green

Invoke-CheckedCommand `
    -Name "React 前端构建" `
    -WorkingDirectory (Join-Path $ProjectRoot "frontend") `
    -Command "npm" `
    -Arguments @("run", "build")

Invoke-CheckedCommand `
    -Name "NestJS 构建" `
    -WorkingDirectory (Join-Path $ProjectRoot "backend\nest-service") `
    -Command "npm" `
    -Arguments @("run", "build")

Invoke-CheckedCommand `
    -Name "NestJS 测试" `
    -WorkingDirectory (Join-Path $ProjectRoot "backend\nest-service") `
    -Command "npm" `
    -Arguments @("test", "--", "--runInBand")

$FastApiRoot = Join-Path $ProjectRoot "backend\fastapi-service"
$VenvPython = Join-Path $FastApiRoot ".venv\Scripts\python.exe"
$PythonCommand = if (Test-Path -LiteralPath $VenvPython) { $VenvPython } else { "python" }

Invoke-CheckedCommand `
    -Name "FastAPI 编译检查" `
    -WorkingDirectory $FastApiRoot `
    -Command $PythonCommand `
    -Arguments @("-m", "compileall", "-q", "app")

Invoke-CheckedCommand `
    -Name "FastAPI 测试" `
    -WorkingDirectory $FastApiRoot `
    -Command $PythonCommand `
    -Arguments @("-m", "pytest", "-q", "tests")

Invoke-CheckedCommand `
    -Name "Gin 测试" `
    -WorkingDirectory (Join-Path $ProjectRoot "backend\gin-service") `
    -Command "go" `
    -Arguments @("test", "./...")

Write-Host "[OK] 发布前验证全部通过。" -ForegroundColor Green

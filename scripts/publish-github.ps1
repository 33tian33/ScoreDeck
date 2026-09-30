param([string]$Repository = 'ScoreDeck-CS')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (!(Get-Command gh -ErrorAction SilentlyContinue)) { throw '请先安装 GitHub CLI (gh) 并执行 gh auth login。' }
gh auth status
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI 尚未登录。' }
git rev-parse --git-dir
if ($LASTEXITCODE -ne 0) { throw '请使用附带的 Git bundle 还原仓库，详见 README。' }
$originUrl = git remote get-url origin 2>$null
$hasOrigin = ($LASTEXITCODE -eq 0)
if ($hasOrigin -and $originUrl -match '\.bundle$') {
    git remote remove origin
    $hasOrigin = $false
}
if ($hasOrigin) { git push -u origin main } else { gh repo create $Repository --private --source=. --remote=origin --push }
if ($LASTEXITCODE -ne 0) { throw '上传失败；没有覆盖远端历史，请查看错误信息。' }

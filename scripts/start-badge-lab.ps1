param()
$ErrorActionPreference = 'Stop'
$badgeRoot = Split-Path -Parent $PSScriptRoot
$badgePython = Join-Path $badgeRoot 'backend/.venv/Scripts/python.exe'
$badgeNode = Join-Path $badgeRoot '.tools/node-v24.22.1-win-x64/node.exe'
if (!(Test-Path -LiteralPath $badgeNode)) { $badgeNode = (Get-Command node -ErrorAction Stop).Source }
if (!(Test-Path -LiteralPath $badgePython)) { throw 'Install backend dependencies in backend/.venv first.' }
foreach ($badgePort in @(8010,5176)) {
    if (Get-NetTCPConnection -LocalPort $badgePort -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $badgePort is already in use. Stop the previous Badge Lab with scripts/stop-badge-lab.ps1 first."
    }
}
$badgeLogDir = Join-Path $badgeRoot '.tools'
New-Item -ItemType Directory -Path $badgeLogDir -Force | Out-Null
$badgeEnvironment = @{
    HIKINGPSU_BADGE_LAB='1'; HIKINGPSU_ENV='development'; MONGODB_DB='hikingpsu_badge_lab';
    MONGODB_URI=''; DEMO_MODE='1'; SSLKEYLOGFILE=''; AUTH0_MGMT_CLIENT_ID=''; AUTH0_MGMT_CLIENT_SECRET=''
}
$badgeSaved = @{}
try {
    foreach ($badgeKey in $badgeEnvironment.Keys) {
        $badgeSaved[$badgeKey] = [Environment]::GetEnvironmentVariable($badgeKey,'Process')
        [Environment]::SetEnvironmentVariable($badgeKey,$badgeEnvironment[$badgeKey],'Process')
    }
    $badgeApi = Start-Process -FilePath $badgePython -ArgumentList @('-m','uvicorn','dev.badge_lab:create_app','--factory','--host','127.0.0.1','--port','8010') -WorkingDirectory (Join-Path $badgeRoot 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $badgeLogDir 'badge-lab-api.stdout.log') -RedirectStandardError (Join-Path $badgeLogDir 'badge-lab-api.stderr.log')
    $badgeWeb = Start-Process -FilePath $badgeNode -ArgumentList @('node_modules/vite/bin/vite.js','--config','vite.badge-lab.config.js') -WorkingDirectory (Join-Path $badgeRoot 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $badgeLogDir 'badge-lab-web.stdout.log') -RedirectStandardError (Join-Path $badgeLogDir 'badge-lab-web.stderr.log')
    @{backend=$badgeApi.Id;frontend=$badgeWeb.Id;workspace=$badgeRoot} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $badgeLogDir 'badge-lab-processes.json') -Encoding UTF8
} finally {
    foreach ($badgeKey in $badgeSaved.Keys) { [Environment]::SetEnvironmentVariable($badgeKey,$badgeSaved[$badgeKey],'Process') }
}
Write-Output 'Badge Lab: http://127.0.0.1:5176/dev/badge-lab.html'
Write-Output 'Development only. Synthetic account and in-memory data; restart clears all achievements.'
Write-Output 'Stop: powershell -ExecutionPolicy Bypass -File scripts/stop-badge-lab.ps1'

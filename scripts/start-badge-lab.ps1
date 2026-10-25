param()
$ErrorActionPreference = 'Stop'
$badgeRoot = Split-Path -Parent $PSScriptRoot
$badgePython = Join-Path $badgeRoot 'backend/.venv/Scripts/python.exe'
$badgeNode = Join-Path $badgeRoot '.tools/node-v24.22.1-win-x64/node.exe'
$badgeConfig = Join-Path $badgeRoot 'backend/.env.devtools.local'
if (!(Test-Path -LiteralPath $badgeConfig)) { throw 'Configure backend/.env.devtools.local and backend/.devtools/allowlist.json first. See docs/devtools-access.md. No unauthenticated test server will be started.' }
if (!(Test-Path -LiteralPath $badgeNode)) { $badgeNode = (Get-Command node -ErrorAction Stop).Source }
if (!(Test-Path -LiteralPath $badgePython)) { throw 'Install backend/requirements-devtools.txt in backend/.venv first.' }
if (Get-NetTCPConnection -LocalPort 5176 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 5176 is already in use. Stop the previous developer service first.' }
$badgeLogDir = Join-Path $badgeRoot '.tools'
New-Item -ItemType Directory -Path $badgeLogDir -Force | Out-Null
Push-Location (Join-Path $badgeRoot 'frontend')
try {
    & $badgeNode node_modules/vite/bin/vite.js build --config vite.devtools.config.js
    if ($LASTEXITCODE -ne 0) { throw 'Private developer build failed; service was not started.' }
} finally { Pop-Location }
Push-Location (Join-Path $badgeRoot 'backend')
try {
    & $badgePython -m dev.run --env-file .env.devtools.local --check
    if ($LASTEXITCODE -ne 0) { throw 'Developer configuration was rejected; service was not started.' }
} finally { Pop-Location }
$badgeSavedKeylog = [Environment]::GetEnvironmentVariable('SSLKEYLOGFILE','Process')
try {
    [Environment]::SetEnvironmentVariable('SSLKEYLOGFILE',$null,'Process')
    $badgeApi = Start-Process -FilePath $badgePython -ArgumentList @('-m','dev.run','--env-file','.env.devtools.local') -WorkingDirectory (Join-Path $badgeRoot 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $badgeLogDir 'badge-lab-api.stdout.log') -RedirectStandardError (Join-Path $badgeLogDir 'badge-lab-api.stderr.log')
    @{backend=$badgeApi.Id;workspace=$badgeRoot} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $badgeLogDir 'badge-lab-processes.json') -Encoding UTF8
} finally { [Environment]::SetEnvironmentVariable('SSLKEYLOGFILE',$badgeSavedKeylog,'Process') }
Write-Output 'Developer tools: http://127.0.0.1:5176/'
Write-Output 'Real Auth0 login plus explicit contributor authorization required. Missing or invalid settings keep access closed.'
Write-Output 'See .tools/badge-lab-api.stderr.log if startup is refused.'

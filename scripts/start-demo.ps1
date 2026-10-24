param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$python = Join-Path $projectRoot 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    throw 'Create backend/.venv and install backend/requirements.txt first. See README.md.'
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$localNode = Get-ChildItem (Join-Path $projectRoot '.tools/node-*-win-x64/node.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
if ($localNode) {
    $node = $localNode.FullName
} elseif ($nodeCommand) {
    $node = $nodeCommand.Source
} else {
    throw 'Install Node.js LTS or place a portable Node runtime under .tools/. See README.md.'
}
$npm = Join-Path (Split-Path $node -Parent) 'node_modules/npm/bin/npm-cli.js'
if (-not (Test-Path -LiteralPath $npm)) {
    throw 'npm was not found next to Node.js. Install a complete Node.js LTS distribution.'
}
if (-not (Test-Path (Join-Path $projectRoot 'frontend/node_modules/vite'))) {
    throw 'Install frontend dependencies with npm ci first. See README.md.'
}

# Fail before starting either service if a previous server is still using a port.
foreach ($port in @(8000, 5173)) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try { $listener.Start() }
    catch { throw "Port $port is already in use. Stop the existing server before starting the demo." }
    finally { $listener.Stop() }
}

$logDir = Join-Path $projectRoot '.tools'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$previousMode = $env:DEMO_MODE
$previousPath = $env:PATH
$backend = $null
try {
    $env:DEMO_MODE = '1'
    $env:PATH = "$(Split-Path $node -Parent);$env:PATH"
    $backend = Start-Process -FilePath $python -WorkingDirectory (Join-Path $projectRoot 'backend') `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000') `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir 'demo-backend.log') `
        -RedirectStandardError (Join-Path $logDir 'demo-backend-error.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($backend.HasExited) { throw 'Backend exited. Check .tools/demo-backend-error.log.' }
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8000/health' -TimeoutSec 1
            if ($health.ok) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw 'Backend startup timed out. Check .tools/demo-backend-error.log.' }
    Write-Host 'HikingPSU offline demo: http://localhost:5173'
    Write-Host 'API docs: http://127.0.0.1:8000/docs | Ctrl+C stops the demo.'
    & $node $npm --prefix (Join-Path $projectRoot 'frontend') run dev -- --host 127.0.0.1 --port 5173 --strictPort
    if ($LASTEXITCODE -ne 0) { throw "Frontend exited with code $LASTEXITCODE." }
} finally {
    if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id }
    $env:DEMO_MODE = $previousMode
    $env:PATH = $previousPath
}

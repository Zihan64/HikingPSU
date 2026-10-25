$ErrorActionPreference = 'Stop'
$badgeRoot = Split-Path -Parent $PSScriptRoot
$badgePidPath = Join-Path $badgeRoot '.tools/badge-lab-processes.json'
if (!(Test-Path -LiteralPath $badgePidPath)) { Write-Output 'No Badge Lab process record found.'; return }
$badgeProcesses = Get-Content -LiteralPath $badgePidPath -Raw | ConvertFrom-Json
if ($badgeProcesses.workspace -ne $badgeRoot) { throw 'Process record belongs to another workspace.' }
foreach ($badgeRole in @('backend','frontend')) {
    $badgeProcessId = [int]$badgeProcesses.$badgeRole
    $badgeProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $badgeProcessId"
    $badgeExpected = if ($badgeRole -eq 'backend') { 'uvicorn.*dev\.badge_lab:create_app' } else { 'vite.*vite\.badge-lab\.config\.js' }
    if ($badgeProcess -and $badgeProcess.CommandLine -match $badgeExpected) {
        taskkill.exe /PID $badgeProcessId /T /F | Out-Null
        Write-Output "Stopped Badge Lab $badgeRole."
    }
}
Remove-Item -LiteralPath $badgePidPath

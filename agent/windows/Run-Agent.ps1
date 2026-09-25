$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'agent.log'
try {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) {
        Move-Item $log "$log.old" -Force
    }
    $config = Get-Content (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
    $env:WAKE_URL = $config.WakeUrl
    $env:WAKE_TOKEN = $config.Token
    $env:WAKE_SHUTDOWN_COMMAND = 'shutdown.exe /s /t 0'
    # Windows PowerShell can turn native stderr into terminating errors with Stop.
    $ErrorActionPreference = 'Continue'
    & (Join-Path $PSScriptRoot 'runtime\node.exe') (Join-Path $PSScriptRoot 'agent.mjs') >> $log 2>&1
    $agentExitCode = $LASTEXITCODE
    if ($null -eq $agentExitCode) { exit 1 }
    exit $agentExitCode
} catch {
    Add-Content $log "Agent startup failed: $($_.Exception.Message)"
    exit 1
}

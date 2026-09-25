#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$WakeUrl
)
$ErrorActionPreference = 'Stop'
$uri = [Uri]$WakeUrl
if (-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('http', 'https') -or $uri.Query -or $uri.Fragment -or $uri.UserInfo) {
    throw 'WakeUrl must be an HTTP(S) URL without credentials, a query, or fragment.'
}
$installDir = Join-Path $env:ProgramData 'WakeAgent'
$taskName = 'Wake Agent'
foreach ($file in @('runtime\node.exe', 'agent.mjs', 'Run-Agent.ps1')) {
    if (-not (Test-Path (Join-Path $PSScriptRoot $file))) { throw "Missing package file: $file" }
}
$secureToken = Read-Host 'Paste the agent enrollment token' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'An enrollment token is required.' }
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $taskName
        # Wait for the old process to release the bundled executable before upgrading.
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') { break }
            Start-Sleep -Seconds 1
        }
        if ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') { throw 'The existing agent did not stop.' }
    }
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    # The task runs as SYSTEM: only Administrators and SYSTEM may read the token or modify its code.
    & icacls.exe $installDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not secure the installation directory.' }
    if ([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($installDir)) {
        Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $installDir -Recurse -Force
    }
    @{ WakeUrl = $WakeUrl.TrimEnd('/'); Token = $token } | ConvertTo-Json | Set-Content (Join-Path $installDir 'config.json') -Encoding UTF8
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $token = $null
}
$runner = Join-Path $installDir 'Run-Agent.ps1'
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory $installDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Persistent connection to Wake for remote shutdown requests.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed and started '$taskName'. Logs: $installDir\agent.log"

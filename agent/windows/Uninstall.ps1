#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName 'Wake Agent' -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName 'Wake Agent'
    Unregister-ScheduledTask -TaskName 'Wake Agent' -Confirm:$false
}
Write-Host 'Wake Agent task removed. You can now delete C:\ProgramData\WakeAgent to remove its files and token.'

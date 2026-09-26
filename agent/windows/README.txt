Wake Agent for Windows x64

Includes Node.js 24. No separate Node.js installation is needed.

1. In Wake, choose Edit > Shutdown settings > Remote agent > Add agent strategy.
   Copy the enrollment token (it is only shown once).
2. Extract this ZIP to a local folder.
3. Open Windows PowerShell as Administrator, change to the extracted wake-agent
   folder, and run:

   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -WakeUrl "http://192.168.86.2:8091"

4. Paste the token when prompted. The installer starts the agent immediately.

The "Wake Agent" scheduled task runs as SYSTEM at every boot, without a login.
It has no execution time limit and restarts after failure. The agent keeps one
HTTP event stream open; it reconnects automatically if Wake or the network is
unavailable. The local shutdown action is shutdown.exe /s /t 0.

Installation: C:\ProgramData\WakeAgent
Logs: C:\ProgramData\WakeAgent\agent.log
Configuration: C:\ProgramData\WakeAgent\config.json (Administrators/SYSTEM only)

To update, extract a newer download and run Install.ps1 again. It stops the old
agent before copying the new files. Re-enter the existing token, or create a
new strategy if you no longer have it.

To uninstall, run Uninstall.ps1 from an Administrator PowerShell. It removes
the task; then delete C:\ProgramData\WakeAgent to remove the files and token.
Removing the strategy from Wake also revokes the token.

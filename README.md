# Wake

A small Wake-on-LAN service with a browser dashboard for managing machines and sending wake requests.

## Run

1. Create a `.env` file from `.env.example` if you need to override the defaults.
2. Start the service and MySQL:

   ```sh
   docker compose up -d --build
   ```

3. Open the service on the configured `WAKE_HTTP_PORT` (default: `3000`).

The dashboard is served by Express and uses Vue 3 and Element Plus directly from a CDN—there is no frontend build step.

## API

- `GET /instances` — list instances, hosts, and MAC addresses
- `POST /instances` — create an instance
- `PUT /instances/:instance` — update an instance
- `DELETE /instances/:instance` — delete an instance
- `POST /instances/:instance/wake` — send Wake-on-LAN packets to its MAC addresses

## Shutdown strategies

An instance can use either or both shutdown strategies:

- **SSH** — Wake connects to the configured `user@host` using its stored private key and runs the platform default command (`sudo shutdown -h now` for non-root Linux/macOS logins, `shutdown -h now` for root, and `shutdown /s /t 0` for Windows), or a configured replacement command.
- **Remote agent** — the dashboard shows an enrollment token once. The agent keeps an authenticated HTTP event stream open at `GET /agent/events` (Server-Sent Events). Wake pushes shutdown commands over that connection immediately. The agent acknowledges a command using `POST /agent/commands/:request_id/complete` before running its local shutdown command. Both requests use `Authorization: Bearer <token>`.

Commands remain queued in MySQL while the agent is offline and are delivered when it reconnects. Repeated shutdown requests share the pending command until it is acknowledged. An acknowledgement atomically claims a command so duplicate deliveries cannot execute it twice. As before, acknowledgement means receipt, not successful shutdown: if the local command fails or the machine crashes after acknowledgement, send a new request after fixing the problem.

SSH needs the `openssh-client` package, which is included in the container image. Enrollment tokens are stored as hashes and are shown only when the remote-agent strategy is created.

For the included Node agent, copy `agent/index.js` to the remote machine and run it with Node 24+:

```sh
WAKE_URL=https://wake.example.com \
WAKE_TOKEN='token-shown-once-in-the-dashboard' \
WAKE_SHUTDOWN_COMMAND='sudo shutdown -h now' \
node index.js
```

Run it under your platform's service manager. There is no polling interval: idle agents keep one connection open, with a small heartbeat every 25 seconds on that same connection. Only shutdown acknowledgements make a separate HTTP request. Broken connections reconnect with exponential backoff and jitter (up to 60 seconds); a missing heartbeat for 75 seconds triggers reconnection. Invalid tokens stop the agent. Removing a strategy or machine closes its connection.

Deploy the updated server and agent together; the old `/agent/commands/next` polling endpoint and `WAKE_POLL_INTERVAL_MS` are no longer used. Existing enrollment tokens still work. Run one agent per token and one Wake server process: active streams are tracked in memory, so multiple server workers would require shared pub/sub for live delivery.

If Wake is behind a reverse proxy, disable response buffering for `/agent/events` and allow long-lived HTTP streams (idle timeout above 75 seconds). The server sends `X-Accel-Buffering: no` for nginx. Use HTTPS when connecting over an untrusted network.

Wake does not run background availability checks or scheduled pings. Each `GET /instances` request checks the configured hosts on demand, so the dashboard shows a current up/down result only when it is refreshed.

## Gitea Actions deployment and Windows download

`.gitea/workflows/deploy.yml` runs on pushes to `master` and manual dispatch. It tests the application, builds a portable Windows x64 agent ZIP, uploads it to the run's **Artifacts**, then syncs the application to `192.168.86.2:docker/wake/` over SSH. After syncing, it runs `docker compose up -d --build --force-recreate` in the remote `~/docker/wake` directory to rebuild the image and restart the Compose services. A sync or Compose failure fails the deployment job. Linux rsync uses `-avz` for archive, verbose, and compression.

Enable repository Actions and provide a Linux Docker runner labelled `ubuntu-latest` that can reach `192.168.86.2:22`, your Gitea server, GitHub Actions repositories, npm, and nodejs.org. The workflow uses a Node 24 Debian container and installs its packaging/deployment tools inside that container.

Set these repository **Actions secrets**:

| Secret | Value |
| --- | --- |
| `RELEASE_TOKEN` | Gitea access token with repository write permission, allowed to create `v*` tags |
| `DEPLOY_USER` | SSH username on `192.168.86.2` (the account whose home contains `docker/wake`) |
| `DEPLOY_SSH_KEY` | Unencrypted deployment private key; authorize its public key on the destination |
| `DEPLOY_KNOWN_HOSTS` | Verified SSH known-hosts entry for `192.168.86.2` |

The remote account needs write access to `~/docker/wake`, its parent `~/docker` must exist, and rsync plus Docker Compose must be installed on the destination. The SSH account must be able to run Docker without an interactive sudo prompt. The sync preserves remote-only files and excludes `.git`, `node_modules`, build downloads, and `.env` files. Configure the production environment on the destination. SSH host-key checking stays enabled.

After a successful build, open the workflow run and download **wake-agent-windows-x64** from **Artifacts**. Extract the artifact and its included `wake-agent-windows-x64.zip`. The package includes Node.js, the persistent agent, and installation/uninstallation scripts. No credentials are included in the download. Node's Windows runtime is verified against its official SHA-256 checksum during packaging.

In an **Administrator Windows PowerShell**, change to the extracted `wake-agent` directory and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -WakeUrl "http://192.168.86.2:8091"
```

Paste the remote-agent enrollment token at the hidden prompt. The installer copies the package to `C:\ProgramData\WakeAgent`, restricts access to Administrators/SYSTEM, and registers **Wake Agent** in Task Scheduler. It starts immediately and at boot as SYSTEM without a user login, runs indefinitely, and restarts after failures. Logs are in `C:\ProgramData\WakeAgent\agent.log`. Run `Uninstall.ps1` as Administrator to remove the task.

The package is for Windows x64; this is a Task Scheduler startup task, not a Windows Service Control Manager service. Use the bundled `README.txt` for update and removal instructions.


## Release versions

The build runs `npm run build` to update `package.json` and both version fields in `package-lock.json`. It reads the latest commit message (subject and body):

- `#major`: increment major and reset minor/patch, e.g. `1.2.3` → `2.0.0`.
- `#minor`: increment minor and reset patch, e.g. `1.2.3` → `1.3.0`.
- No marker: increment patch, e.g. `1.2.3` → `1.2.4`.

Markers are case-insensitive; major wins if both appear. For a multi-commit push, put the marker in the final commit message. The baseline is the greater of the checked-in package version and the highest stable `vX.Y.Z` Git tag. With the initial `1.0.0` baseline, the first unmarked build is `1.0.1`.

After packaging succeeds, CI publishes the version tag on the source commit using `RELEASE_TOKEN`. It does not push a version-only commit or trigger another branch build. A retry of a tagged commit reuses that release version. The deploy job applies that exact version before rsync and the Docker rebuild. Release workflows are serialized with a concurrency group; older Gitea installations without concurrency support should use a single release runner slot. A conflicting tag push fails the build before deployment.

The application shows its version next to **Wake** in the header, loaded from `GET /version`. The Windows ZIP also contains a top-level `VERSION` file; `runtime/VERSION` identifies its bundled Node.js version. Local `npm run build` updates the manifests but does not create or push tags.

## Daily shutdown schedules

Open a machine's **Edit → Schedules → Shutdown** tab, enable **Daily shutdown**, choose a time and timezone, and select **Save schedule**. The default is midnight (`00:00`) in your browser's timezone. Configure an SSH or remote-agent shutdown strategy first. Turn off Daily shutdown and save to pause the timer.

Wake checks saved schedules every 15 seconds on the server; the dashboard does not need to remain open. A machine runs at most once per local calendar day. Its configured timezone follows daylight-saving changes: a repeated time runs once, and a time skipped by the spring-forward transition is skipped that day. Times missed while Wake is stopped are not replayed. Last run time and dispatch result appear in the Schedule tab; a sent request is not confirmation that the operating system powered off.

Offline remote agents are skipped. Scheduled agent commands are sent only over an existing connection, expire after 60 seconds, and are never replayed on reconnect. SSH attempts fail normally if a machine is unreachable. Manual shutdown requests retain their existing durable queue behavior. Failed scheduled attempts are recorded and are not retried that day; send a manual request if needed. Claims are persisted before dispatch to prevent duplicate runs after a restart; a crash between claiming and sending can therefore skip that day's shutdown.

The database migration creates `shutdown_schedule` and adds scheduled-command expiry to `shutdown_strategy` automatically at startup. Schedule configuration is available through `PUT /instances/:instance/shutdown-schedule` with `{ "enabled": true, "time": "00:00", "timezone": "America/Los_Angeles" }`, and is returned as `shutdown_schedule` by `GET /instances`.

## Notifications

Open **Phone notifications** in the header to choose which machine events Wake sends through Pushover. The settings apply globally to all machines and default to on: upcoming shutdown warnings, start requests, manual shutdown requests, shutdown failures, shutdown schedule changes, wake schedule changes, and scheduled start/shutdown results. Wake does not show notification badges, toasts, or a notification history in the dashboard. A shutdown warning opens the affected machine's schedule controls.

In **Edit → Schedules → Shutdown**, set **Warn before shutdown (minutes)**. The default is **10**, the range is **0–120**, and **0** disables the advance warning. Both new and existing schedules default to 10 minutes after migration. Wake sends the warning to your phone through Pushover. The web dashboard and computer agent display no notifications. Reminders are claimed once per scheduled local date, including midnight and daylight-saving transitions. A missed warning is not replayed after downtime. Shutdown still happens on schedule if the phone notification cannot be delivered.

Configure Pushover by creating an application to get its app token and using your Pushover user key. Add the values shown in `.env.example` to your Compose `.env` file, preserving any settings already there. Set `WAKE_PUSHOVER_APP_TOKEN`, `WAKE_PUSHOVER_USER_KEY`, and `WAKE_PUBLIC_URL`; the URL must be reachable from your phone. `WAKE_PUSHOVER_DEVICE` is optional. Restart Wake after setting them. Pushover warnings link to the affected machine's schedule controls and expire at the scheduled shutdown time.

Each machine card shows the next scheduled shutdown with **Skip** and **Delay 1 hour** controls. These apply only to the upcoming occurrence, leaving the daily schedule intact. A delay is rejected if it would overlap the next daily shutdown. If Wake is offline at the scheduled time, the shutdown is skipped rather than queued.

Behind a reverse proxy, allow the long-lived `/agent/events` stream and disable response buffering for that route.


## Daily wake schedules

Open **Edit → Schedules → Wake**, enable **Daily wake**, choose a time and timezone, and save. The default is 8:00 AM in your browser's timezone. Wake and shutdown schedules are saved independently, so you can wake a machine in the morning and shut it down at night.

Scheduled wakes send Wake-on-LAN packets to every configured MAC address. Wake requests must be enabled and at least one MAC must be configured before enabling the schedule. If wake requests are later paused or all MACs are removed, the scheduled attempt is skipped. Wake-on-LAN must be enabled on the target computer; a successful packet send does not guarantee the machine powered on. No remote agent or SSH connection is required.

The server runs the schedule while the browser is closed, once per local calendar day with the same timezone/DST handling as shutdown schedules. Missed wake times are not replayed after downtime. Last run details appear under the Wake schedule. Wake schedule results are sent through Pushover.

The startup migration creates `wake_schedule`. `PUT /instances/:instance/wake-schedule` accepts `{ "enabled": true, "time": "08:00", "timezone": "America/Los_Angeles" }`, and `GET /instances` includes each machine's `wake_schedule`.

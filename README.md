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

- **SSH** — Wake connects to the configured `user@host` using its stored private key and runs the platform default command (`sudo shutdown -h now` for Linux/macOS, `shutdown /s /t 0` for Windows), or a configured replacement command.
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

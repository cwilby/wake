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
- **Remote agent** — the dashboard produces a one-time enrollment token. An agent on the remote host polls `POST /agent/commands/next` with `{ "token": "…" }`. When it receives `{ "shutdown": true, "request_id": "…" }`, it acknowledges receipt with `POST /agent/commands/:request_id/complete` and the same token, then runs its local shutdown command.

SSH needs the `openssh-client` package, which is included in the container image. Enrollment tokens are stored as hashes and are shown only when the remote-agent strategy is created.

For the included Node agent, copy `agent/index.js` to the remote machine and run it with Node 18+:

```sh
WAKE_URL=https://wake.example.com \
WAKE_TOKEN='token-shown-once-in-the-dashboard' \
WAKE_SHUTDOWN_COMMAND='sudo shutdown -h now' \
node index.js
```

Run it under your platform's service manager. The agent polls every five seconds by default; set `WAKE_POLL_INTERVAL_MS` to change that interval.

Wake does not run background availability checks or scheduled pings. Each `GET /instances` request checks the configured hosts on demand, so the dashboard shows a current up/down result only when it is refreshed.

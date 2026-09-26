# Wake

Wake is a self-hosted dashboard for waking, scheduling, and shutting down computers across your network. It helps keep power-hungry machines off until you need them.

## Features

- Wake machines over Wake-on-LAN and view their availability on demand.
- Shut down machines over SSH or through a remote agent with a persistent connection.
- Schedule daily wake and shutdown times, with controls to skip or delay the next shutdown.
- Receive configurable phone alerts through Pushover.
- Manage machines from a responsive web dashboard.

## Run

Wake requires Docker Compose and a reachable MySQL database. This Compose file starts Wake; configure it to use your MySQL instance.

```sh
cp .env.example .env
# Edit .env with your MySQL connection settings.
docker compose up -d --build
```

Open `http://localhost:3000` (or the port set by `WAKE_HTTP_PORT`). Database migrations run automatically at startup.

## Shutdown agents

An instance can use SSH or the included remote agent. The agent keeps one authenticated connection open and receives shutdown requests immediately; it does not poll. The dashboard displays the enrollment token once when you add the agent strategy.

The Node agent requires Node.js 24 or newer. A Windows x64 package with a bundled Node.js runtime is attached to each GitHub Release. Run it under a service manager so it starts with the computer. See [`agent/windows/README.txt`](agent/windows/README.txt) for Windows installation instructions.

Use HTTPS when connecting over an untrusted network. If Wake is behind nginx, disable response buffering for `/agent/events` and allow long-lived connections.

## Configuration and security

Set `WAKE_SSH_KEY_ENCRYPTION_KEY` when using SSH strategies. Generate it once with `openssl rand -base64 32`, keep it stable, and back it up securely. Wake uses it to encrypt stored private keys; losing or changing it makes saved SSH keys unreadable.

Pushover settings are optional. Set `WAKE_PUSHOVER_APP_TOKEN`, `WAKE_PUSHOVER_USER_KEY`, and `WAKE_PUBLIC_URL` to enable phone notifications. The device setting is optional.

Schedules run on the Wake server even when the dashboard is closed. Missed schedule times are skipped. Offline agents are not queued for scheduled shutdowns.

## Development and releases

```sh
npm ci
npm test
```

GitHub Actions runs tests on pushes and pull requests. To prepare a release, run `npm run build`, commit the updated version, create the matching `vX.Y.Z` tag, and push it. The tag workflow publishes a GitHub Release with the Windows agent and a Docker image to GHCR. A `#major` or `#minor` marker in the latest commit message selects that version bump; otherwise the patch version advances.

See [`.env.example`](.env.example) for environment variable names. Wake is licensed under the [MIT License](LICENSE).


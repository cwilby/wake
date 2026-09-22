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

Wake does not run background availability checks or scheduled pings. The dashboard's optional auto-refresh only reloads the saved instance list.

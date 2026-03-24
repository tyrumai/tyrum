# `@tyrum/web`

Standalone Vite web app for Tyrum.

## Purpose

This app boots `@tyrum/operator-ui` in a browser environment and connects it to the gateway via
`@tyrum/operator-app/browser`.

The gateway can also serve the bundled Tyrum web app at `/ui`. This app exists for standalone web
development and browser-focused iteration.

## Entry point

- `apps/web/src/main.tsx`

The app:

- imports shared state/actions through `@tyrum/operator-app` and presentation components through
  `@tyrum/operator-ui` public entrypoints only
- resolves gateway HTTP/WS URLs from local storage, Vite env vars, or the current origin
- persists the operator bearer token in browser local storage and supports `?token=` bootstrap
- creates the shared operator core manager and admin access controller
- renders `OperatorUiApp` in `mode="web"`

## Commands

- `pnpm --filter @tyrum/web dev`
- `pnpm --filter @tyrum/web build`
- `pnpm --filter @tyrum/web typecheck`

## Live gateway workflow

Use this flow when you want Vite HMR from `apps/web` while talking to a real gateway instead of
the bundled `/ui` app.

### 1. Start an isolated gateway

Use a throwaway gateway home so you do not mutate your normal `~/.tyrum` state while iterating on
UI work:

```bash
export TYRUM_DEV_HOME="$(mktemp -d /tmp/tyrum-live-gateway.XXXXXX)"

pnpm --filter @tyrum/gateway exec node bin/tyrum.mjs \
  --home "$TYRUM_DEV_HOME" \
  --host 127.0.0.1 \
  --port 8788
```

Capture both bootstrap tokens from stdout on first start:

- `system`
- `default-tenant-admin`

### 2. Allow the local Vite origin

The standalone app runs on `http://localhost:5173` and talks to the gateway on
`http://127.0.0.1:8788`, so the gateway must allow those browser origins. This only needs to be
done once per `TYRUM_DEV_HOME`.

```bash
export TYRUM_SYSTEM_TOKEN="<bootstrap system token>"

CURRENT_CONFIG="$(curl -s \
  -H "Authorization: Bearer $TYRUM_SYSTEM_TOKEN" \
  http://127.0.0.1:8788/system/deployment-config)"

UPDATED_CONFIG="$(node -e '
const current = JSON.parse(process.argv[1]);
const next = current.config;
const origins = new Set(next.server.corsOrigins ?? []);
origins.add("http://localhost:5173");
origins.add("http://127.0.0.1:5173");
next.server.corsOrigins = [...origins];
process.stdout.write(JSON.stringify({
  config: next,
  reason: "Allow local Vite dev origins",
}));
' "$CURRENT_CONFIG")"

curl -s -X PUT http://127.0.0.1:8788/system/deployment-config \
  -H "Authorization: Bearer $TYRUM_SYSTEM_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$UPDATED_CONFIG"
```

After updating the deployment config, stop the gateway process and rerun the start command above so
the running server picks up the new CORS settings.

### 3. Start Vite against the gateway

```bash
VITE_GATEWAY_HTTP_BASE_URL="http://127.0.0.1:8788" \
VITE_GATEWAY_WS_URL="ws://127.0.0.1:8788/ws" \
pnpm --filter @tyrum/web exec vite --host localhost --port 5173 --strictPort
```

### 4. Bootstrap browser auth once

Open the standalone app with the bootstrap admin token:

```text
http://localhost:5173/ui/?token=<default-tenant-admin token>
```

The app stores the token in browser local storage and removes it from the URL after first load.

### 5. Reuse or reset local state

- Keep the same `TYRUM_DEV_HOME` if you want to preserve gateway state between sessions.
- Stop the gateway and remove that temp directory when you want a clean local environment.

## Notes

- Runtime UI state is primarily shared with other operator surfaces through
  `@tyrum/operator-app` and `@tyrum/operator-ui`.
- Gateway reconfiguration is stored in browser local storage (`tyrum-gateway-http`,
  `tyrum-gateway-ws`).
- Browser auth is stored in browser local storage (`tyrum-operator-token`).
- Browser-host concerns stay in `apps/web`: gateway URL persistence, token bootstrap, reload
  handling, and browser node consent/runtime wiring.

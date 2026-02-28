# Desktop Sandbox (Linux + noVNC)

The `desktop-sandbox` Docker Compose profile starts a reproducible Linux desktop (Xfce) with noVNC for operator takeover, plus a paired Tyrum Desktop node.

## Quickstart

```bash
docker compose --profile desktop-sandbox up -d --build
```

- noVNC takeover: `http://localhost:6080/vnc.html?autoconnect=true`
- Gateway UI: `http://localhost:8788/ui`

> Security note: the sandbox desktop is intentionally unauthenticated in v1 (VNC/noVNC). The `desktop-sandbox` profile binds ports to `127.0.0.1` by default; do not expose it to untrusted networks.

## Pairing and takeover

1. Get the admin token:

```bash
docker compose exec -T tyrum sh -lc 'cat /var/lib/tyrum/.admin-token' | tr -d '\r\n'
```

2. Open `http://localhost:8788/ui`, paste the token on the Connect page, and connect.
3. Open the **Pairing** page, approve the pending pairing request, and use the **Open takeover** link to open the noVNC session.

## Manual verification (desktop snapshot)

After approving pairing, run a Desktop snapshot:

```bash
TOKEN="$(docker compose exec -T tyrum sh -lc 'cat /var/lib/tyrum/.admin-token' | tr -d '\r\n')"
curl -sS -H "authorization: Bearer ${TOKEN}" -H "content-type: application/json" \
  -d '{"key":"agent:default:manual:desktop-sandbox","lane":"main","steps":[{"type":"Desktop","args":{"op":"snapshot","include_tree":false}}]}' \
  "http://localhost:8788/workflow/run"
```

## Smoke test

```bash
bash scripts/smoke-desktop-sandbox.sh
```

Set `TYRUM_SMOKE_KEEP_RUNNING=1` to leave containers running after the script finishes.

## Running the desktop automation tests

The gateway test suite includes an end-to-end smoke test that boots an in-process gateway, starts the `desktop-sandbox` container, approves pairing, then dispatches a Desktop `snapshot` and a safe `mouse` action.

This test currently requires Linux + a working Docker daemon, and may take a few minutes on first run while the sandbox image builds.

```bash
pnpm exec vitest run packages/gateway/tests/integration/desktop-sandbox-e2e.test.ts
```

Useful environment variables:

- `TYRUM_DESKTOP_SANDBOX_REBUILD=1` forces a Docker rebuild of the sandbox image.
- `TYRUM_DESKTOP_SANDBOX_IMAGE=<tag>` uses an existing prebuilt image tag.

## Notes

- The sandbox image includes DBus and AT-SPI packages (`dbus`, `dbus-x11`, `at-spi2-core`) to maximize a11y availability for Linux backends.
- Override the URL shown in the pairing UI via `TYRUM_DESKTOP_SANDBOX_TAKEOVER_URL` (useful when the host is remote).

# Desktop Sandbox (Linux + noVNC)

The `desktop-sandbox` Docker Compose profile starts a reproducible Linux desktop (Xfce) with noVNC for operator takeover, plus a paired Tyrum Desktop node.

## Quickstart

```bash
docker compose --profile desktop-sandbox up -d --build
```

- noVNC takeover: `http://localhost:6080/vnc.html?autoconnect=true`
- Gateway UI: `http://localhost:8788/ui`

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

## Notes

- The sandbox image includes DBus and AT-SPI packages (`dbus`, `dbus-x11`, `at-spi2-core`) to maximize a11y availability for Linux backends.
- Override the URL shown in the pairing UI via `TYRUM_DESKTOP_SANDBOX_TAKEOVER_URL` (useful when the host is remote).

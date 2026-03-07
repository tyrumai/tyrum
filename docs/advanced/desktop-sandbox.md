# Desktop Sandbox (Linux + noVNC)

The `desktop-sandbox` Docker Compose profile starts a reproducible Linux desktop (Xfce) with noVNC for operator takeover, plus a paired Tyrum Desktop node.

## Quickstart

```bash
export GATEWAY_TOKEN="$(openssl rand -hex 32)"
docker compose --profile desktop-sandbox up -d --build
```

- noVNC takeover: `http://localhost:6080/vnc.html?autoconnect=true`
- Gateway UI: `http://localhost:8788/ui`

> Security note: the sandbox desktop is intentionally unauthenticated in v1 (VNC/noVNC). The `desktop-sandbox` profile binds ports to `127.0.0.1` by default; do not expose it to untrusted networks.

## Pairing and takeover

1. Open `http://localhost:8788/ui`, paste `$GATEWAY_TOKEN` on the Connect page, and connect.
2. Open the **Pairing** page, approve the pending pairing request, and use the **Open takeover** link to open the noVNC session.

## Manual QA checklist (operator UI)

- [ ] Trigger a Desktop `act` approval (any flow that causes `tool.node.dispatch` with `capability=tyrum.desktop` and `op=act`).
- [ ] In **Approvals**, the card shows a **Desktop** summary (op + action + target) and an **Open takeover** link.
- [ ] Approve and deny both work; the approval disappears after resolution.
- [ ] In **Runs**, open the run → attempt → **Artifacts** and confirm:
  - [ ] screenshot artifacts render inline
  - [ ] a11y tree artifacts render as an expandable JSON viewer
  - [ ] artifacts are clearly marked **Sensitive**

## Manual verification (desktop snapshot)

After approving pairing, run a Desktop snapshot:

```bash
TOKEN="${GATEWAY_TOKEN}"
curl -sS -H "authorization: Bearer ${TOKEN}" -H "content-type: application/json" \
  -d '{"key":"agent:default:manual:desktop-sandbox","lane":"main","steps":[{"type":"Desktop","args":{"op":"snapshot","include_tree":false}}]}' \
  "http://localhost:8788/workflow/run"
```

## Manual verification (AT-SPI a11y)

1. Open the noVNC takeover and launch a GUI app (for example Xfce Terminal). You can also launch one from the host:

```bash
docker compose exec -T desktop-sandbox bash -lc 'DISPLAY=:0 xfce4-terminal --title "Tyrum A11y Smoke" >/tmp/tyrum-a11y-smoke.log 2>&1 &'
```

2. Run snapshot → query → act with `include_tree: true`:

```bash
TOKEN="${GATEWAY_TOKEN}"
curl -sS -H "authorization: Bearer ${TOKEN}" -H "content-type: application/json" \
  -d '{"key":"agent:default:manual:a11y:desktop-sandbox","lane":"main","steps":[{"type":"Desktop","args":{"op":"snapshot","include_tree":true,"max_nodes":512,"max_text_chars":8192}},{"type":"Desktop","args":{"op":"query","selector":{"kind":"a11y","name":"Tyrum A11y Smoke"},"limit":1}},{"type":"Desktop","args":{"op":"act","target":{"kind":"a11y","name":"Tyrum A11y Smoke"},"action":{"kind":"focus"}}}]}' \
  "http://localhost:8788/workflow/run"
```

If the run pauses for policy approvals, approve in the Gateway UI (or use the existing smoke script as a reference for automating approvals).

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

# Tyrum Desktop

Tyrum Desktop is the Electron desktop app for running the Tyrum operator UI on your machine.

## Install

Desktop installers are published on GitHub Releases (see the [Installation Guide](install.md)).
Download the installer for your OS:

- macOS: `.dmg` (or `.zip`)
- Windows: `.exe`
- Linux: `.AppImage` (or `.tar.gz`)

If you want to verify downloads, each release includes `SHA256SUMS`.

## First run

On launch, open the **Connection** page and choose one of these modes:

### Embedded

Start an embedded gateway managed by the desktop app.

1. Keep the default port (`8788`) or pick a free port.
2. Click **Start Gateway**.

### Remote

Connect the desktop app to an existing gateway.

1. Set **Gateway WebSocket URL** (must include `/ws`).
2. Enter your admin token (see the [Getting Started](getting-started.md) guide).
3. Optionally set **TLS certificate fingerprint (SHA-256)** when connecting over TLS with a
   self-signed certificate (see [Remote Gateway Guide](advanced/remote-gateway.md)).
4. Click **Connect**.

## Troubleshooting

### Connection issues

- Confirm the gateway is reachable from your machine (host/port/firewalls).
- Confirm the WebSocket URL includes `/ws`.
- If you changed `GATEWAY_TOKEN`, update the token used by the desktop app.

### macOS permissions

Some desktop capabilities require macOS permissions:

- Accessibility
- Screen Recording

Use **Diagnostics** to check and request missing permissions.

### Updates

The desktop app can check for updates and install downloaded releases from the **Diagnostics** page.
If needed, you can also install from a local release file via **Diagnostics → Use Local Release File**.

### Resetting configuration

Desktop configuration is stored at `~/.tyrum/desktop-node.json` (or `$TYRUM_HOME/desktop-node.json`).
If the app is in a bad state, you can stop the app and remove that file to reset to defaults.

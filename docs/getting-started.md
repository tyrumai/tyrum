# Quick Start

This guide helps new users go from install to first successful run.

## 1. Install Tyrum

Use the installer script:

```bash
curl -fsSL https://get.tyrum.ai/install.sh | bash
```

Or install with npm:

```bash
npm i -g @tyrum/gateway
```

## 2. Start the gateway

```bash
tyrum
```

By default, Tyrum runs local-first and binds to `127.0.0.1`.

## 3. Open the operator UI (`/ui`)

Open:

- `http://127.0.0.1:8788/ui`

On first visit, the UI prompts for your admin token and bootstraps a browser auth cookie via `POST /auth/session`.

If you did not set `GATEWAY_TOKEN`, the gateway generates an admin token and stores it at:

- `~/.tyrum/.admin-token` (or `$TYRUM_HOME/.admin-token`)

## 4. Singleton agent routes (default on)

```bash
tyrum
```

To disable singleton agent routes:

```bash
TYRUM_AGENT_ENABLED=0 tyrum
```

## 5. Common first-time checks

- Verify Node.js 24.x: `node -v`
- Verify command install path: `command -v tyrum`
- If a port conflict occurs, set `GATEWAY_PORT`.

Example:

```bash
GATEWAY_PORT=8789 tyrum
```

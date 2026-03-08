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

If you did not provision tokens ahead of time, capture the `default-tenant-admin` bootstrap token from the gateway startup logs. The gateway prints bootstrap tokens once on first run.

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

## 6. Scaling later

- `single-host` / desktop-style installs use local filesystem state under `TYRUM_HOME`.
- HA/shared deployments use `state.mode=shared` plus shared Postgres, shared artifact storage, and a shared secret key source.
- Shared deployments do not provide a filesystem import path; configure durable state through the DB-backed operator/config surfaces before cutover.

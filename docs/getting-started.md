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

If you lose that token later, issue a fresh recovery token against the same gateway home or DB:

```bash
tyrum tokens issue-default-tenant-admin
```

After you sign in, open `Configure -> Tokens` to manage tenant-scoped tokens in the UI. The list shows token metadata only; newly minted token secrets are shown once in the issue result and cannot be read back later.

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
- To migrate an existing local home into shared stores before cutover:

```bash
tyrum import-home ~/.tyrum --db <shared-db-uri> --tenant-id 00000000-0000-4000-8000-000000000001
```

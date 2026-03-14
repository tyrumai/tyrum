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

Override startup home/host/port with explicit CLI flags, for example:

```bash
tyrum --home "$HOME/.tyrum-demo" --port 8789
```

## 3. Open the operator UI (`/ui`)

Open:

- `http://127.0.0.1:8788/ui`

On first visit, the UI prompts for your admin token and bootstraps a browser auth cookie via `POST /auth/session`.

If you did not provision tokens ahead of time, capture the `default-tenant-admin` bootstrap token from the gateway startup logs. The gateway prints bootstrap tokens once on first run.

If you lose that token later, issue a fresh recovery token against the same gateway home or DB:

```bash
tyrum tokens issue-default-tenant-admin
```

After you sign in, open `Configure -> Tokens` to manage tenant-scoped tokens in the UI. The page provides a filterable token list plus structured add/edit/revoke flows; newly minted token secrets are shown once in the issue result and cannot be read back later.

If the gateway is missing first-run configuration, Tyrum opens a guided setup wizard after sign-in by default. You can skip the wizard and configure providers, model presets, execution-profile assignments, and the default agent manually from the normal `Configure` and `Agents` pages, then resume the guided flow later from the dashboard if you want it.

## 4. Singleton agent routes (default on)

```bash
tyrum
```

Singleton agent routes are enabled by default. Their durable availability is controlled by deployment config `agent.enabled`.

## 5. Common first-time checks

- Verify Node.js 24.x: `node -v`
- Verify command install path: `command -v tyrum`
- If a port conflict occurs, restart with `--port`.

Example:

```bash
tyrum --port 8789
```

## 6. Scaling later

- `single-host` / desktop-style installs use local filesystem state under the gateway home (`~/.tyrum` by default, overridden with `--home`).
- HA/shared deployments use `state.mode=shared` plus shared Postgres, shared artifact storage, and a shared secret key source.
- Shared deployments do not provide a filesystem import path; configure durable state through the DB-backed operator/config surfaces before cutover.

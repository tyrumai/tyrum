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
tyrum-gateway
```

By default, Tyrum runs local-first and binds to `127.0.0.1`.

## 3. Open the web app

Open:

- `http://127.0.0.1:8788/app`

## 4. Singleton agent routes (default on)

```bash
tyrum-gateway
```

To disable singleton agent routes:

```bash
TYRUM_AGENT_ENABLED=0 tyrum-gateway
```

## 5. Common first-time checks

- Verify Node.js 24.x: `node -v`
- Verify command install path: `command -v tyrum-gateway`
- If a port conflict occurs, set `GATEWAY_PORT`.

Example:

```bash
GATEWAY_PORT=8789 tyrum-gateway
```

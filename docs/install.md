# Installation Guide

This guide covers end-user installation options for Tyrum gateway.

## Supported Platforms

- macOS
- Linux
- Windows (npm install path)

## Prerequisites

- Node.js 24.x
- npm (bundled with Node)

## Option 1: One-line Installer (Recommended)

Installs a versioned `@tyrum/gateway` release tarball after verifying `SHA256SUMS`.

```bash
curl -fsSL https://get.tyrum.ai/install.sh | bash
```

Install from a channel:

```bash
curl -fsSL https://get.tyrum.ai/install.sh | bash -s -- --channel beta
```

Install a specific version:

```bash
curl -fsSL https://get.tyrum.ai/install.sh | bash -s -- 2026.2.18
```

Advanced overrides:

- `TYRUM_REPO` (default: `rhernaus/tyrum`)
- `TYRUM_VERSION` (for non-`latest` installs)
- `TYRUM_CHANNEL` (`stable` | `beta` | `dev`)

## Option 2: npm Global Install

```bash
npm i -g @tyrum/gateway
```

Run:

```bash
tyrum
```

## Operator UI (`/ui`)

When the gateway is running, it serves the operator web UI as a single-page app at:

- `http://127.0.0.1:8788/ui`

Browser login uses a cookie bootstrap flow:

- The UI sends your admin token to `POST /auth/session` once (`{ "token": "<admin token>" }`).
- The gateway sets an `HttpOnly` auth cookie for the browser.
- Subsequent HTTP and WebSocket requests authenticate via that cookie (tokens are never placed in URLs).

On first startup, the gateway prints bootstrap tokens to stdout once:

- `system`
- `default-tenant-admin`

Capture the `default-tenant-admin` token and use it to sign in to `/ui` unless you already provisioned tokens through another flow.

If you lose the token later, recover by issuing a fresh one against the same gateway home or DB:

```bash
tyrum tokens issue-default-tenant-admin
```

After login, open `Configure -> Tokens` to manage tenant tokens with a filterable list, structured add/edit/revoke dialogs, and one-time secret reveal on creation. Existing token secrets are not readable from the UI because the gateway stores token secrets hashed at rest; only freshly issued tokens are shown once in the issue result.

Singleton agent routes are enabled by default. Their durable availability is controlled by deployment config `agent.enabled`, not by a startup environment variable.

## Option 3: GitHub Releases

From each `v*` release, download:

- Desktop installers (`.dmg`, `.zip`, `.exe`, `.AppImage`, `.tar.gz`)
- npm package tarballs (`tyrum-*.tgz`)
- `SHA256SUMS`

Release workflow: `.github/workflows/release.yml`

Release publishing is gated on the `ci` workflow passing for the tagged commit (`.github/workflows/ci.yml`).

## Release Channels and Naming

- **stable**: `vYYYY.M.D` (npm dist-tag: `latest`)
- **beta**: `vYYYY.M.D-beta.N` (npm dist-tag: `next`)
- **dev**: `vYYYY.M.D-dev.N` (npm dist-tag: `dev`)

GitHub release title format is:

- `tyrum YYYY.M.D`
- `tyrum YYYY.M.D-beta.N`
- `tyrum YYYY.M.D-dev.N`

## Updating

In-place update via installed CLI (recommended once `tyrum` is already on PATH):

```bash
tyrum update
```

Update from a release channel:

```bash
tyrum update --channel beta
```

Pin to an exact release version:

```bash
tyrum update --version 2026.2.18
```

Re-install/update via installer script (useful for fresh bootstrap or PATH repair):

```bash
curl -fsSL https://get.tyrum.ai/install.sh | bash
curl -fsSL https://get.tyrum.ai/install.sh | bash -s -- --channel beta
```

Difference:

- `tyrum update` uses your existing installed command and updates `@tyrum/gateway` via npm.
- `install.sh` fetches signed release assets (`SHA256SUMS` verified) and reinstalls globally.

Desktop app updates:

- The desktop app checks for updates automatically and notifies when one is available.
- Download/install remains user initiated from the Diagnostics page.
- You can also install from a local release file via **Diagnostics → Use Local Release File**.

## Version Pinning

Install a specific version:

```bash
npm i -g @tyrum/gateway@2026.2.18
```

or:

```bash
curl -fsSL https://get.tyrum.ai/install.sh | bash -s -- 2026.2.18
```

## Next Steps

- [Quick Start](getting-started.md)
- [Remote Gateway Guide](advanced/remote-gateway.md)
- [Deployment Profiles](advanced/deployment-profiles.md)
- [Multi-Node Guide](advanced/multi-node.md)

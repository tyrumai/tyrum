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
tyrum-gateway
```

Enable singleton agent routes:

```bash
TYRUM_AGENT_ENABLED=1 tyrum-gateway
```

## Option 3: GitHub Releases

From each `v*` release, download:

- Desktop installers (`.dmg`, `.zip`, `.exe`, `.AppImage`, `.tar.gz`)
- npm package tarballs (`tyrum-*.tgz`)
- `SHA256SUMS`

Release workflow: `.github/workflows/release.yml`

## Release Channels and Naming

- **stable**: `vYYYY.M.D` (npm dist-tag: `latest`)
- **beta**: `vYYYY.M.D-beta.N` (npm dist-tag: `next`)
- **dev**: `vYYYY.M.D-dev.N` (npm dist-tag: `dev`)

GitHub release title format is:

- `tyrum YYYY.M.D`
- `tyrum YYYY.M.D-beta.N`
- `tyrum YYYY.M.D-dev.N`

## Updating

If installed with npm:

```bash
npm i -g @tyrum/gateway@latest
```

If installed with the script:

```bash
curl -fsSL https://get.tyrum.ai/install.sh | bash
```

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
- [Multi-Node Guide](advanced/multi-node.md)

# Tyrum

Tyrum is an autonomous worker platform built around a gateway, an agent runtime, and safety boundaries for execution, approvals, and audit evidence. It is self-hosted, serves an operator UI at `/ui`, and exposes authenticated HTTP and WebSocket access.

The repository contains the gateway runtime, the transport and node SDKs, the shared contracts package, the operator surfaces, the desktop app, and the public docs site. Detailed architecture, deployment, and feature documentation lives under [`docs/`](docs/index.md).

For package work, treat the [target-state architecture](docs/architecture/target-state.md) as the live contributor contract.

## Install

Use the installer:

```bash
curl -fsSL https://get.tyrum.ai/install.sh | bash
```

Or run from source:

```bash
pnpm install
pnpm --filter @tyrum/gateway start
```

On first start, the gateway prints bootstrap tokens. Keep them. If you lose the `default-tenant-admin` token later, recover by issuing a fresh one with `tyrum tokens issue-default-tenant-admin`. After login, `Configure -> Tokens` lets you manage tenant-scoped tokens in the UI. The default local UI is:

```text
http://127.0.0.1:8788/ui
```

## Develop

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm --filter @tyrum/gateway start
```

Prereqs:

- Node.js 24
- pnpm 10

## Canonical Docs

- [Docs home](docs/index.md)
- [Install guide](docs/install.md)
- [Architecture overview](docs/architecture/index.md)
- [Target-state architecture](docs/architecture/target-state.md)
- [Contributing](CONTRIBUTING.md)
- [Desktop app](apps/desktop/README.md)

## Workspace

The main packages in the current tree are:

- `packages/gateway`: gateway runtime and `tyrum` CLI
- `packages/transport-sdk`: HTTP and WebSocket transport SDK
- `packages/node-sdk`: node lifecycle and capability SDK
- `packages/contracts`: shared contracts, schemas, and generated artifacts
- `packages/operator-app`: shared operator state and actions
- `packages/operator-ui`: reusable operator UI components and pages
- `apps/desktop`: Electron desktop app
- `apps/web`: standalone operator web app
- `apps/docs`: public documentation site

For everything beyond install and local development, use the docs above rather than treating this README as operational documentation.

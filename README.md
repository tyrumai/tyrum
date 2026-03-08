# Tyrum

Tyrum is a self-hosted autonomous worker agent platform built around a single gateway runtime. It is local-first by default, serves an operator UI at `/ui`, and uses authenticated HTTP and WebSocket access for automation, approvals, and auditability.

The repository contains the gateway runtime, the client SDK, shared schemas, the desktop app, and the public docs site. Detailed architecture, deployment, and feature documentation lives under [`docs/`](docs/index.md).

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
- [Contributing](CONTRIBUTING.md)
- [Desktop app](apps/desktop/README.md)
- [Docs site](apps/docs/README.md)

## Workspace

The main packages are:

- `packages/gateway`: gateway runtime and `tyrum` CLI
- `packages/client`: client SDK
- `packages/schemas`: shared schemas and types
- `apps/desktop`: Electron desktop app
- `apps/docs`: public documentation site

For everything beyond install and local development, use the docs above rather than treating this README as operational documentation.

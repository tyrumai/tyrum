# `@tyrum/desktop-node`

Desktop capability-provider runtime for Tyrum.

## Purpose

This package connects to the gateway as a `role: node` peer and exposes desktop-local capabilities
such as desktop automation, accessibility-backed inspection, and OCR-assisted query support.

It is used both by the standalone desktop-node CLI and by desktop-oriented Tyrum environments.

## Entry points

- library: `packages/desktop-node/src/index.ts`
- CLI runtime: `packages/desktop-node/src/cli/run-cli.ts`
- binary: `tyrum-desktop-node`

## Runtime shape

The node runtime:

- loads or creates a device identity under `$TYRUM_HOME/desktop-node`
- connects to the gateway over WebSocket using node auth
- advertises desktop capabilities and listens for pairing updates
- executes desktop actions through the provider/backends in `src/providers`

## Commands

- `pnpm --filter @tyrum/desktop-node build`
- `pnpm --filter @tyrum/desktop-node start -- --help`
- `pnpm --filter @tyrum/desktop-node test`

## Notes

- Default gateway WS URL: `ws://127.0.0.1:8788/ws`
- Tokens can be passed directly or loaded from a token file/environment.
- This package is a node runtime, not an operator client. Approval, policy, and pairing decisions
  still live in the gateway and operator surfaces.

# `@tyrum/web`

Standalone Vite operator web app for Tyrum.

## Purpose

This app boots `@tyrum/operator-ui` in a browser environment and connects it to the gateway via
`@tyrum/operator-core/browser`.

The gateway can also serve a bundled operator UI at `/ui`. This app exists for standalone web
development and browser-focused iteration.

## Entry point

- `apps/web/src/main.tsx`

The app:

- resolves gateway HTTP/WS URLs from local storage, Vite env vars, or the current origin
- supports cookie auth by default and bearer-token bootstrap from URL auth handoff
- creates the shared operator core manager and admin access controller
- renders `OperatorUiApp` in `mode="web"`

## Commands

- `pnpm --filter @tyrum/web dev`
- `pnpm --filter @tyrum/web build`
- `pnpm --filter @tyrum/web typecheck`

## Notes

- Runtime UI state is primarily shared with other operator surfaces through
  `@tyrum/operator-core` and `@tyrum/operator-ui`.
- Gateway reconfiguration is stored in browser local storage (`tyrum-gateway-http`,
  `tyrum-gateway-ws`).

# `@tyrum/web`

Standalone Vite web app for Tyrum.

## Purpose

This app boots `@tyrum/operator-ui` in a browser environment and connects it to the gateway via
`@tyrum/operator-app/browser`.

The gateway can also serve the bundled Tyrum web app at `/ui`. This app exists for standalone web
development and browser-focused iteration.

## Entry point

- `apps/web/src/main.tsx`

The app:

- resolves gateway HTTP/WS URLs from local storage, Vite env vars, or the current origin
- persists the operator bearer token in browser local storage and supports `?token=` bootstrap
- creates the shared operator core manager and admin access controller
- renders `OperatorUiApp` in `mode="web"`

## Commands

- `pnpm --filter @tyrum/web dev`
- `pnpm --filter @tyrum/web build`
- `pnpm --filter @tyrum/web typecheck`

## Notes

- Runtime UI state is primarily shared with other operator surfaces through
  `@tyrum/operator-app` and `@tyrum/operator-ui`.
- Gateway reconfiguration is stored in browser local storage (`tyrum-gateway-http`,
  `tyrum-gateway-ws`).
- Browser auth is stored in browser local storage (`tyrum-operator-token`).

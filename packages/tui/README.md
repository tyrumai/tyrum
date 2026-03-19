# `@tyrum/tui`

Ink-based terminal UI client for Tyrum.

## Purpose

This package provides a live terminal operator surface backed by `@tyrum/operator-app`.

It is aimed at operators who want a persistent terminal workflow rather than the browser or desktop
app.

## Entry points

- library: `packages/tui/src/index.ts`
- CLI runtime: `packages/tui/src/cli.ts`
- binary: `tyrum-tui`

## Runtime shape

The TUI:

- resolves gateway URLs, auth token, and device identity from CLI args and environment
- keeps CLI arg parsing, gateway URL resolution, and device identity persistence local to the host
- creates a shared `@tyrum/operator-app` runtime for operator workflows and state
- renders the Ink app defined in `packages/tui/src/app.tsx`

## Commands

- `pnpm --filter @tyrum/tui build`
- `pnpm --filter @tyrum/tui start -- --help`
- `pnpm --filter @tyrum/tui test`

## Notes

- Default gateway URL: `http://127.0.0.1:8788`
- Default Tyrum home: `~/.tyrum`
- The TUI is an operator client only; it does not execute node capability calls itself.

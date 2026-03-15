# `@tyrum/cli`

Command-line operator client for Tyrum.

## Purpose

This package provides scripted and terminal-friendly access to common operator workflows without
running the full desktop or web UI.

## Entry points

- library: `packages/cli/src/index.ts`
- CLI runtime: `packages/cli/src/run-cli.ts`
- binary: `tyrum-cli`

## Current command areas

- approvals
- pairing
- workflow run/resume/cancel
- elevated mode
- policy bundle and policy overrides
- secrets
- operator config and device identity

## Commands

- `pnpm --filter @tyrum/cli build`
- `pnpm --filter @tyrum/cli start -- --help`

## Notes

- The CLI uses the shared client stack from `@tyrum/client` and `@tyrum/cli-utils`.
- It is an operator client, not a capability node. Device automation stays behind paired nodes.

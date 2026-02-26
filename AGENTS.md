# AGENTS.md

## Project overview

- Tyrum is a self-hosted autonomous worker agent platform built around a single “gateway” runtime (HTTP + WebSocket).
- Monorepo: TypeScript (strict, ESM) on Node.js 24; pnpm workspace (`packages/*`, `apps/*`).
- Core packages: `@tyrum/gateway` (server + CLI `tyrum`), `@tyrum/client` (SDK), `@tyrum/schemas` (shared Zod types).
- Gateway persists to SQLite by default, supports Postgres for split roles, and serves an integrated web UI at `/app`.
- Public docs live in `docs/` and are built as a Docusaurus site in `apps/docs`.

## Repo map

- `.github/` GitHub Actions + repo automation
- `apps/desktop/` Electron desktop app (Vite + tsdown)
- `apps/docs/` Docusaurus docs site
- `charts/` Helm chart(s)
- `config/` runtime configuration (e.g. model gateway YAML)
- `docs/` architecture + user docs
- `packages/client/` WebSocket client SDK
- `packages/gateway/` gateway runtime + CLI
- `packages/schemas/` shared Zod schemas/types
- `patches/` pnpm `patchedDependencies` patches
- `scripts/` install + docs gate + smoke scripts
- `coverage/`, `dist/`, `node_modules/` generated artifacts (gitignored)

## Setup

- Prereqs: Node `24` (see `.nvmrc` / `.node-version`) + pnpm `10` (CI uses pnpm/action-setup).
- Install: `pnpm install`
- Optional (container/split smoke): Docker + `docker compose`.
- Useful env vars when running gateway:
  - `GATEWAY_HOST`, `GATEWAY_PORT`
  - `GATEWAY_DB_PATH` (SQLite path or `postgres://...` for split roles)
  - `GATEWAY_TOKEN` (required for HTTP/WS auth)
  - `TYRUM_HOME`; set `TYRUM_AGENT_ENABLED=0` to disable agent routes

## Common commands

- Install: `pnpm install`
- Typecheck (workspace packages): `pnpm typecheck`
- Lint: `pnpm lint`
- Test: `pnpm test` (coverage: `pnpm test:coverage`, watch: `pnpm test:watch`)
- Build all workspace packages: `pnpm build`
- Start gateway: `pnpm --filter @tyrum/gateway start`
- Start gateway (agents disabled): `TYRUM_AGENT_ENABLED=0 pnpm --filter @tyrum/gateway start`
- Docs site: `pnpm --filter @tyrum/docs start` / `pnpm --filter @tyrum/docs build`
- Docs public-content gate (CI): `pnpm docs:public-check` (or `bash scripts/check-public-docs.sh`)
- Split-role + Postgres smoke test: `bash scripts/smoke-postgres-split.sh`
- Desktop:
  - Build: `pnpm --filter tyrum-desktop build`
  - Typecheck (CI-style): `pnpm exec tsc --noEmit --project apps/desktop/tsconfig.json`

## Conventions

- TypeScript ESM workspace (`"type": "module"`); relative TS imports use `.js` specifiers (e.g. `./foo.js`), matching `tsconfig.base.json` (`moduleResolution: Node16`).
- Lint: oxlint (`oxlint.json`).
- Tests: Vitest (`vitest.config.ts`); tests live under `packages/*/tests` and `apps/*/tests`.

## Safety / do-not-touch

- Generated/ignored (see `.gitignore`): `dist/`, `node_modules/`, `coverage/`, `apps/docs/build/`, `apps/docs/.docusaurus/`, `apps/desktop/release/`, `*.tsbuildinfo`, `*.db`.
- `pnpm-lock.yaml` should only change with dependency updates; `patches/` must continue to apply after upgrades.
- Network/auth defaults matter: gateway is designed to require `GATEWAY_TOKEN`; be cautious changing auth or bind-address behavior.

## PR / commit expectations

- Branch naming: `<issue-number>-<slug>` (see `CONTRIBUTING.md`).
- Before commit: `node scripts/format-changed.mjs --write --staged`.
- Before PR: `pnpm typecheck && pnpm test && pnpm lint`.
- Keep diffs small; update docs/tests alongside behavior changes; ensure workflows in `.github/workflows/` stay green.

## Related docs

- `README.md`
- `CONTRIBUTING.md`
- `docs/index.md`
- `docs/architecture/index.md`
- `docker-compose.yml`

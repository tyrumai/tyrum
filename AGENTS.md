# AGENTS.md

## Project overview

- Tyrum is a self-hosted autonomous worker agent platform built around a single “gateway” runtime (HTTP + WebSocket).
- Monorepo: TypeScript (strict, ESM) on Node.js 24; pnpm workspace (`packages/*`, `apps/*`).
- Core packages: `@tyrum/gateway` (server + CLI `tyrum`), `@tyrum/client` (SDK), `@tyrum/schemas` (shared Zod types).
- Gateway persists to SQLite by default, supports Postgres for split roles, and serves the operator web UI at `/ui`.
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
- Gateway configuration is DB-backed (no runtime env config). Bootstrapping uses defaults + CLI flags:
  - `--home` (default: `~/.tyrum`)
  - `--db` (default: `<home>/gateway.db`, or `postgres://...` for split roles)
  - `--host` (default: `127.0.0.1`)
  - `--port` (default: `8788`)
  - `--role` (`all|edge|worker|scheduler`)

## Common commands

- Install: `pnpm install`
- Typecheck (workspace packages): `pnpm typecheck`
- Lint: `pnpm lint`
- Test: `pnpm test` (coverage: `pnpm test:coverage`, watch: `pnpm test:watch`)
- Build all workspace packages: `pnpm build`
- Start gateway: `pnpm --filter @tyrum/gateway start`
- Gateway prints bootstrap tokens (system + default tenant admin) once on first run — capture them for API/WS access.
- Docs site: `pnpm --filter @tyrum/docs start` / `pnpm --filter @tyrum/docs build`
- Docs public-content gate (CI): `pnpm docs:public-check` (or `bash scripts/check-public-docs.sh`)
- Split-role + Postgres smoke test: `bash scripts/smoke-postgres-split.sh`
- Desktop:
  - Build: `pnpm --filter tyrum-desktop build`
  - Typecheck (CI-style): `pnpm exec tsc --noEmit --project apps/desktop/tsconfig.json`

## Conventions

- TypeScript ESM workspace (`"type": "module"`); relative TS imports use `.js` specifiers (e.g. `./foo.js`), matching `tsconfig.base.json` (`moduleResolution: Node16`).
- Lint: oxlint (`.oxlintrc.json`).
- Tests: Vitest (`vitest.config.ts`); tests live under `packages/*/tests` and `apps/*/tests`.

## Safety / do-not-touch

- Generated/ignored (see `.gitignore`): `dist/`, `node_modules/`, `coverage/`, `apps/docs/build/`, `apps/docs/.docusaurus/`, `apps/desktop/release/`, `*.tsbuildinfo`, `*.db`.
- `pnpm-lock.yaml` should only change with dependency updates; `patches/` must continue to apply after upgrades.
- Network/auth defaults matter: tokens are tenant-scoped and enforced for HTTP/WS; be cautious changing auth or bind-address behavior.

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

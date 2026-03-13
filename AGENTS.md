# AGENTS.md

## Project overview

- Tyrum is a self-hosted autonomous worker agent platform built around a single “gateway” runtime (HTTP + WebSocket).
- Monorepo: TypeScript (strict, ESM) on Node.js 24; pnpm workspace (`packages/*`, `apps/*`).
- Runtime surfaces include `@tyrum/gateway` (server + bundled operator UI), `@tyrum/cli`, `@tyrum/tui`, `@tyrum/client`, and `@tyrum/schemas`.
- Operator experiences are split across `@tyrum/operator-core`, `@tyrum/operator-ui`, `apps/web` (Vite web app), and `apps/desktop` (Electron app backed by `@tyrum/desktop-node`).
- Gateway persists to SQLite by default, supports Postgres for split roles, and serves the bundled operator UI at `/ui`.
- Public docs live in `docs/` and are built as a Docusaurus site in `apps/docs`.

## Repo map

- `.github/` GitHub Actions + repo automation
- `apps/desktop/` Electron desktop app (Vite + tsdown)
- `apps/docs/` Docusaurus docs site
- `apps/web/` standalone operator web app (Vite + React)
- `charts/` Helm chart(s)
- `config/` runtime configuration (e.g. model gateway YAML)
- `docker/` container and sandbox assets
- `docs/` architecture + user docs
- `packages/cli/` operator CLI commands
- `packages/client/` WebSocket client SDK
- `packages/desktop-node/` desktop-local node/runtime helpers
- `packages/gateway/` gateway runtime + CLI
- `packages/operator-core/` shared operator state/actions
- `packages/operator-ui/` reusable operator UI components/pages
- `packages/schemas/` shared Zod schemas/types
- `packages/tui/` terminal UI client
- `patches/` pnpm `patchedDependencies` patches
- `scripts/` install + docs gate + smoke scripts
- `coverage/`, `dist/`, `node_modules/`, `web/`, `.worktrees/` generated or local-only artifacts (gitignored)

## Setup

- Prereqs: Node `24` (see `.nvmrc` / `.node-version`) + pnpm `10` (CI uses pnpm/action-setup).
- Install: `pnpm install`
- Repo hooks install automatically via the root `prepare` script; rerun with `pnpm setup:githooks` if needed.
- Local hooks:
  - `pre-commit`: runs `pnpm format:check-staged` and `pnpm lint`
  - `pre-push`: runs `pnpm lint`, `pnpm typecheck`, and `pnpm exec tsc --noEmit --project apps/desktop/tsconfig.json`
- Optional (container/split smoke): Docker + `docker compose`.
- Gateway configuration is DB-backed (no runtime env config). Bootstrapping uses defaults + CLI flags:
  - `--home` (default: `~/.tyrum`)
  - `--db` (default: `<home>/gateway.db`, or `postgres://...` for split roles)
  - `--migrations-dir` (override migrations directory for checks/tooling)
  - `--host` (default: `127.0.0.1`)
  - `--port` (default: `8788`)
  - `--role` (`all|edge|worker|scheduler|desktop-runtime`)
  - `--trusted-proxies`, `--tls-ready`, `--tls-self-signed`
  - `--allow-insecure-http`, `--enable-engine-api`, `--enable-snapshot-import`

## Common commands

- Install: `pnpm install`
- Typecheck (workspace packages): `pnpm typecheck`
- Desktop typecheck (CI-style): `pnpm exec tsc --noEmit --project apps/desktop/tsconfig.json`
- Lint: `pnpm lint`
- Format check: `pnpm format:check`
- Format write: `pnpm format`
- Test: `pnpm test` (coverage: `pnpm test:coverage`, watch: `pnpm test:watch`)
- Build all workspace packages: `pnpm build`
- Start gateway: `pnpm --filter @tyrum/gateway start`
- Start standalone web app: `pnpm --filter @tyrum/web dev`
- Gateway prints bootstrap tokens (system + default tenant admin) once on first run — capture them for API/WS access.
- Docs site: `pnpm --filter @tyrum/docs start` / `pnpm --filter @tyrum/docs build`
- Docs public-content gate (CI): `pnpm docs:public-check` (or `bash scripts/check-public-docs.sh`)
- Split-role + Postgres smoke test: `bash scripts/smoke-postgres-split.sh`
- Desktop:
  - Build: `pnpm --filter tyrum-desktop build`
  - Test: `pnpm --filter tyrum-desktop test`
  - Package artifacts: `pnpm --filter tyrum-desktop dist`

## Conventions

- TypeScript ESM workspace (`"type": "module"`); relative TS imports use `.js` specifiers (e.g. `./foo.js`), matching `tsconfig.base.json` (`moduleResolution: Node16`).
- Lint: oxlint (`.oxlintrc.json`).
- Formatting: root Prettier scripts (`pnpm format`, `pnpm format:check`) plus `node scripts/format-changed.mjs` for staged-file workflows.
- Tests: Vitest (`vitest.config.ts`); tests live under `packages/*/tests` and `apps/*/tests`, with scope folders such as `unit/`, `integration/`, `e2e/`, and `contract/` where needed.

## Linting rules for new code

- Write new code to pass lint and type checks without relying on existing baseline debt; avoid introducing code that would require cleanup right before commit.
- Oxlint treats `correctness` issues as errors and will fail the build; `suspicious` and `perf` diagnostics are still actionable and should not be introduced in new code.
- Keep files and functions small enough to avoid ratchet regressions: the repo warns at `500` lines per file, and newly added TypeScript files are also checked against `200` lines per function.
- New TypeScript files should be warning-free under the stricter new-file gate in `.oxlintrc.new-files.json`; do not depend on repo-wide warning baselines for brand new files.
- TypeScript is strict. Code should compile cleanly with `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, and `noUnusedParameters` enabled.
- Use ESM-safe imports and the repo convention for relative TypeScript specifiers: import local modules with `.js` suffixes, not `.ts`.
- Format changed files before committing. Prettier covers tracked `ts`, `tsx`, `js`, `mjs`, `cjs`, `json`, `md`, `mdx`, `yml`, and `yaml` files.

## Safety / do-not-touch

- Generated/ignored (see `.gitignore`): `dist/`, `node_modules/`, `coverage/`, `apps/docs/build/`, `apps/docs/.docusaurus/`, `apps/desktop/release/`, `web/`, `.worktrees/`, `.tmp/`, `tmp/`, `*.tsbuildinfo`, `*.db`, `*.sqlite`, `*.sqlite3`.
- `pnpm-lock.yaml` should only change with dependency updates; `patches/` must continue to apply after upgrades.
- Network/auth defaults matter: tokens are tenant-scoped and enforced for HTTP/WS; be cautious changing auth, bind-address behavior, or operator UI bootstrapping served by the gateway.

## PR / commit expectations

- Branch naming: `<issue-number>-<slug>` (see `CONTRIBUTING.md`).
- Before commit: `node scripts/format-changed.mjs --write --staged`, then ensure `pre-commit` passes (`pnpm format:check-staged` + `pnpm lint`).
- Before push: ensure `pre-push` passes (`pnpm lint && pnpm typecheck && pnpm exec tsc --noEmit --project apps/desktop/tsconfig.json`).
- Before PR: `pnpm typecheck && pnpm exec tsc --noEmit --project apps/desktop/tsconfig.json && pnpm test && pnpm lint && pnpm format:check`.
- Keep diffs small; update docs/tests alongside behavior changes; ensure workflows in `.github/workflows/` stay green.

## Related docs

- `README.md`
- `CONTRIBUTING.md`
- `docs/install.md`
- `docs/index.md`
- `docs/architecture/index.md`
- `docs/desktop.md`
- `apps/desktop/README.md`
- `docker-compose.yml`

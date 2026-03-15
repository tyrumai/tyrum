# Contributing to Tyrum

Thanks for helping build the Tyrum assistant platform.

## 1. Getting Started

- Install Node.js 24.x and pnpm on your host.
- Clone the repository and create branches as `<issue-number>-<slug>`.
- Run `pnpm install` from the repo root to bootstrap all packages.

## 2. Project Structure

| Directory          | Purpose                                               |
| ------------------ | ----------------------------------------------------- |
| `packages/schemas` | Shared Zod types (`@tyrum/schemas`)                   |
| `packages/gateway` | Main gateway process — Hono HTTP + WebSocket + SQLite |
| `packages/client`  | Client SDK for connecting to the gateway              |
| `apps/web`         | Operator web app (Vite + React)                       |
| `apps/desktop`     | Electron desktop app                                  |
| `apps/docs`        | Docs site (Docusaurus)                                |
| `config/`          | Runtime configuration (model gateway YAML)            |
| `docs/`            | Architecture and design documentation                 |

## 3. Local Development

| Task                 | Command                              |
| -------------------- | ------------------------------------ |
| Install dependencies | `pnpm install`                       |
| Type check           | `pnpm typecheck`                     |
| Run tests            | `pnpm test`                          |
| Watch tests          | `pnpm test:watch`                    |
| Lint                 | `pnpm lint`                          |
| Format check         | `pnpm format:check`                  |
| Format (write)       | `pnpm format`                        |
| Build all packages   | `pnpm build`                         |
| Start gateway        | `pnpm --filter @tyrum/gateway start` |

Local hooks (pre-commit/pre-push)

Hooks are installed automatically when you run `pnpm install` (via the `prepare` script).

If you need to (re)install them manually:

```bash
pnpm setup:githooks
```

The repo-local hooks are:

- `pre-commit`: runs `pnpm format:check-staged` and `pnpm lint` for fast checks on commit.
- `pre-push`: runs `pnpm lint`, `pnpm typecheck`, `pnpm exec tsc --noEmit --project apps/desktop/tsconfig.json`, and `pnpm test` for stronger validation before pushing.

## 4. Test Conventions

Use the smallest test scope that proves the behavior you changed:

- `tests/unit/` for single-module behavior and pure logic.
- `tests/integration/` for wiring across modules or package boundaries with real in-process dependencies.
- `tests/e2e/` for full user or gateway flows that boot real servers, WebSocket clients, browsers, containers, or other entry points end-to-end.
- `tests/contract/` for durable schema, migration, and storage compatibility checks.
- `tests/conformance/` for protocol behaviors that multiple implementations must satisfy the same way.

If a package only has one test scope today, keeping those unit-style tests directly under `tests/` is acceptable until another scope is added.

Name executable tests after the behavior under test and keep the scope in the folder, not the file name:

- Prefer `tests/e2e/dispatch.test.ts` over `tests/integration/e2e-dispatch.test.ts`.
- Keep `*.test.ts` for executable tests only.
- Prefer `tests/helpers/` and `tests/fixtures/` for shared helpers and reusable data; small scope-local `*-utils.ts` files are fine when they stay adjacent to one test family.
- Avoid repeating the scope in the file name when the folder already provides it.

## 5. Before Opening a PR

Run these commands and verify all pass:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

If your PR changes database migrations under `packages/gateway/migrations/*`, also verify:

- Naming conventions are followed (PK/FK/timestamps): `docs/architecture/scaling-ha/db-naming-conventions.md`
- SQLite and Postgres stay aligned: `pnpm test packages/gateway/tests/contract/schema-contract.test.ts`

### Coverage (optional locally, enforced in CI)

CI runs `pnpm test` with coverage enabled and enforces both global and per-component minimums.

To inspect coverage locally:

```bash
pnpm test --coverage.enabled
node scripts/coverage/components.mjs
```

For the PR diff/new-code gate (changed lines only; ignores blank/comment-only lines):

```bash
BASE_SHA="$(git merge-base HEAD origin/main)"
node scripts/coverage/diff-lines.mjs --base "$BASE_SHA" --min 80
```

Note: this diff-coverage check is optional and not enforced in CI.

### New-file lint gate (enforced in CI for PRs)

CI enforces lint rules on newly added TypeScript files only (no legacy refactors required).

```bash
BASE_SHA="$(git merge-base HEAD origin/main)"
node scripts/lint/oxlint-new-files.mjs --base "$BASE_SHA"
```

To audit the whole repo (warnings only):

```bash
pnpm lint:oxlint:report
```

## 6. Branch Protections & Reviews

Pull requests must reference their GitHub Issue and pass all required checks:

- `ci-web`
- `security-baseline`
- At least one approving review

Follow the 72-character imperative commit style (e.g. `Add policy gate scaffold`).

## 7. Static Analysis (SAST)

The `sast` workflow runs Semgrep on every PR and on pushes to `main` when there are changes under `packages/` or `apps/`.

- **Where results show up:** GitHub **Security → Code scanning alerts** (uploaded as SARIF). For fork PRs, SARIF upload is skipped (token permissions); findings are still visible in the workflow logs.
- **How to interpret results:** Treat findings as potential vulnerabilities and fix them in the PR. If you believe a finding is a false positive, prefer opening an issue with context rather than suppressing it in code.

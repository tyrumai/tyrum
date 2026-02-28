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

Optional: local hooks (pre-commit/pre-push)

```bash
git config core.hooksPath .githooks
```

This enables repo-local hooks:

- `pre-commit`: runs `pnpm format:check-staged` for fast staged-file formatting checks.
- `pre-push`: runs `pnpm lint` and `pnpm typecheck` for stronger validation before pushing.

## 4. Before Opening a PR

Run these commands and verify all pass:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

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

## 5. Branch Protections & Reviews

Pull requests must reference their GitHub Issue and pass all required checks:

- `ci-web`
- `security-baseline`
- At least one approving review

Follow the 72-character imperative commit style (e.g. `Add policy gate scaffold`).

## 6. Static Analysis (SAST)

The `sast` workflow runs Semgrep on every PR and on pushes to `main` when there are changes under `packages/` or `apps/`.

- **Where results show up:** GitHub **Security → Code scanning alerts** (uploaded as SARIF). For fork PRs, SARIF upload is skipped (token permissions); findings are still visible in the workflow logs.
- **How to interpret results:** Treat findings as potential vulnerabilities and fix them in the PR. If you believe a finding is a false positive, prefer opening an issue with context rather than suppressing it in code.

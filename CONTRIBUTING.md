# Contributing to Tyrum

Thanks for helping build the Tyrum assistant platform.

## 1. Getting Started
- Install Node.js 22+ and pnpm on your host.
- Clone the repository and create branches as `<issue-number>-<slug>`.
- Run `pnpm install` from the repo root to bootstrap all packages.

## 2. Project Structure

| Directory | Purpose |
| --- | --- |
| `packages/schemas` | Shared Zod types (`@tyrum/schemas`) |
| `packages/gateway` | Main gateway process — Hono HTTP + WebSocket + SQLite |
| `packages/client` | Client SDK for connecting to the gateway |
| `web/` | Next.js frontend portal |
| `config/` | Runtime configuration (model gateway YAML) |
| `docs/` | Architecture and design documentation |

## 3. Local Development

| Task | Command |
| --- | --- |
| Install dependencies | `pnpm install` |
| Type check | `pnpm typecheck` |
| Run tests | `pnpm test` |
| Watch tests | `pnpm test:watch` |
| Lint | `pnpm lint` |
| Build all packages | `pnpm build` |
| Start gateway | `pnpm --filter @tyrum/gateway start` |

## 4. Before Opening a PR
Run these commands and verify all pass:
```bash
pnpm typecheck
pnpm test
pnpm lint
```

## 5. Branch Protections & Reviews
Pull requests must reference their GitHub Issue and pass all required checks:
- `ci-web`
- `security-baseline`
- At least one approving review

Follow the 72-character imperative commit style (e.g. `Add policy gate scaffold`).

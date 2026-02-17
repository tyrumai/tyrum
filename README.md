# Tyrum

Self-hosted personal AI assistant platform with a single-instance, single-user runtime. The default profile is local-first and runs without application-layer authentication; services bind to localhost by default.

## Overview
- **Vision:** A chat/voice-native personal assistant that handles execution end-to-end across web, mobile, CLI, and structured APIs while keeping the backend invisible to the user.
- **Deployment profile (default):** user-hosted, single-user, localhost-only (`127.0.0.1`) with no auth prompts.
- **Differentiators:**
  - No hard-coded skills; autonomy emerges from learned memory and generic executors.
  - Proactive nudges with external policy enforcement for spending, PII, and explainability.
  - Generic execution surfaces first, with opportunistic structured integrations (MCP/OpenAPI/GraphQL).
  - Every action remains auditable, reproducible, and backed by minimal constitutional rules.
- Full product concept, architecture diagrams, and appendices live in `docs/product_concept_v1.md`.

## Technology Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 24.x |
| Language | TypeScript (strict, ESM) |
| HTTP framework | Hono |
| Validation/types | Zod |
| Database | SQLite (better-sqlite3) + sqlite-vec |
| Client protocol | WebSocket |
| Package manager | pnpm |
| Build | tsdown |
| Linting | oxlint |
| Testing | Vitest |
| Event bus | mitt (typed EventEmitter) |

## Repository Structure

| Directory | Purpose |
| --- | --- |
| `packages/schemas` | Shared Zod types (`@tyrum/schemas`) |
| `packages/gateway` | Main gateway process — Hono HTTP + WebSocket + SQLite |
| `packages/client` | Client SDK for connecting to the gateway |
| `web/` | Next.js frontend portal |
| `config/` | Runtime configuration (model gateway YAML) |
| `docs/` | Architecture and design documentation |

## Getting Started

1. **Read the concept:** Start with `docs/product_concept_v1.md` to understand goals and architecture.
2. **Install tooling:** Node.js 24.x and pnpm.
3. **Clone & branch:** Fork/clone the repo, create branches as `<issue-number>-<slug>`.
4. **Install dependencies:** `pnpm install` from the repo root.
5. **Run checks:** `pnpm typecheck && pnpm test && pnpm lint`
6. **Start the gateway:** `pnpm --filter @tyrum/gateway start`
7. **Start the portal:** `pnpm --filter tyrum-portal dev`
8. **Run single-instance runtime (web + gateway in one process):** `pnpm --filter tyrum-portal start:single`

### Localhost Safety Defaults

- `GATEWAY_HOST` defaults to `127.0.0.1`.
- `GATEWAY_PORT` defaults to `8080`.
- Binding to non-local interfaces logs a warning because app auth is disabled in the self-hosted profile.
- `pnpm --filter tyrum-portal start:single` serves web + gateway HTTP in one process; WebSocket upgrades on `/ws` return `501` in this mode.

## Development Commands

| Task | Command |
| --- | --- |
| Install dependencies | `pnpm install` |
| Type check | `pnpm typecheck` |
| Run tests | `pnpm test` |
| Watch tests | `pnpm test:watch` |
| Lint | `pnpm lint` |
| Build all packages | `pnpm build` |
| Start gateway | `pnpm --filter @tyrum/gateway start` |
| Start web portal | `pnpm --filter tyrum-portal dev` |
| Start single-instance runtime | `pnpm --filter tyrum-portal start:single` |
| Build web portal | `pnpm --filter tyrum-portal build` |

## Telegram Bot Setup

Follow these steps to provision the Telegram channel safely across local and staging environments.

### 1. Create the bot via BotFather
- Chat with [@BotFather](https://t.me/BotFather) and run `/newbot` to name the assistant and choose a unique handle.
- Copy the API token BotFather returns; treat it as a secret and never paste it in chat or commit history.

### 2. Set the webhook endpoint
- For local development, expose the gateway over TLS using `ngrok`:
  ```bash
  ngrok http http://localhost:3001
  curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    --data-urlencode "url=https://<subdomain>.ngrok.app/ingress/telegram"
  ```

### 3. Wire credentials
- Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_URL` environment variables before starting the gateway.

## Key Documents
- [Product Concept v1](docs/product_concept_v1.md)
- [Working Agreements (DoR/DoD)](docs/working_agreements.md)

## Roadmap
See `docs/product_concept_v1.md` for architecture and feature details.

## Way of Working
- **Issue Lifecycle:** All work lives in GitHub Issues with acceptance criteria; the Tyrum project board tracks Backlog → Ready → In Progress → Review → Done.
- **PR Expectations:** One issue per PR, automated checks pass before review.
- **Continuous Improvement:** Retrospectives update the working agreements.

## Contact & Support
- Discussion and planning live in GitHub Issues and the Tyrum project board.
- For urgent questions, mention the relevant owner in Issues/PRs; long-term decisions belong in `docs/` (ADRs) or in the working agreements.

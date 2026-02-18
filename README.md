# Tyrum

Self-hosted autonomous worker agent platform with a single-instance, single-user runtime. The default profile is local-first and runs without application-layer authentication; services bind to localhost by default.

## Overview
- **Goal:** A chat-first autonomous worker agent that can operate software like a human would, while preferring structured interfaces when available and using web/desktop automation as fallback. It produces audit evidence and asks for approvals when needed. “Personal assistant” is the first role, but the same worker can take on other remote-work roles via configuration.
- **Deployment profile (default):** user-hosted, single-user, localhost-only (`127.0.0.1`) with no auth prompts. Run multiple instances (separate `TYRUM_HOME` + DB) if you want multiple workers.
- **Differentiators:**
  - No hard-coded skills; autonomy emerges from learned memory and generic executors.
  - Approvals + policy gate for spending, PII, and explainability; spend is deny-by-default until configured.
  - Prefer structured interfaces; fall back to web/desktop automation for drop-in “remote worker replacement”.
  - Every action is auditable, reproducible, and backed by minimal constitutional rules.
  - BYOK LLMs via OpenAI-compatible `/v1/*` proxy routes.
- Full vision (goal), architecture diagrams, and appendices live in `docs/vision.md`.

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
| `config/` | Runtime configuration (model gateway YAML) |
| `docs/` | Public user documentation (install, guides, advanced topics) |

Docs are deployed to Cloudflare Pages (`tyrum-docs`) by `.github/workflows/docs-pages.yml`.

## Installation

The gateway can be installed in multiple ways:

1. **One-line installer (recommended):**
   ```bash
   curl -fsSL https://get.tyrum.ai/install.sh | bash
   ```
   Beta channel:
   ```bash
   curl -fsSL https://get.tyrum.ai/install.sh | bash -s -- --channel beta
   ```
2. **npm global install:**
   ```bash
   npm i -g @tyrum/gateway
   ```
   Run:
   ```bash
   tyrum
   ```
   Update:
   ```bash
   tyrum update
   ```
3. **Release assets:** download platform installers and package tarballs from GitHub Releases.

See `docs/install.md` for full details, version pinning, and update commands.

## Getting Started

1. **Read the vision:** Start with `docs/vision.md` to understand goals and architecture.
2. **Install tooling:** Node.js 24.x and pnpm.
3. **Clone & branch:** Fork/clone the repo, create branches as `<issue-number>-<slug>`.
4. **Install dependencies:** `pnpm install` from the repo root.
5. **Run checks:** `pnpm typecheck && pnpm test && pnpm lint`
6. **Start the gateway:** `pnpm --filter @tyrum/gateway start`
   - To enable singleton agent routes (`/agent/status`, `/agent/turn`), set `TYRUM_AGENT_ENABLED=1`.
7. **Open the integrated web app:** `http://127.0.0.1:8080/app`

### Localhost Safety Defaults

- `GATEWAY_HOST` defaults to `127.0.0.1`.
- `GATEWAY_PORT` defaults to `8080`.
- Binding to non-local interfaces logs a warning because app auth is disabled in the self-hosted profile.
- The gateway serves the web UI directly at `/app` and supports WebSocket upgrades on `/ws`.

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
| Start gateway + agent runtime | `TYRUM_AGENT_ENABLED=1 pnpm --filter @tyrum/gateway start` |
| Open integrated app | `http://127.0.0.1:8080/app` |

## Telegram Bot Setup

Follow these steps to provision the Telegram channel safely across local and staging environments.

### 1. Create the bot via BotFather
- Chat with [@BotFather](https://t.me/BotFather) and run `/newbot` to name the agent and choose a unique handle.
- Copy the API token BotFather returns; treat it as a secret and never paste it in chat or commit history.

### 2. Set the webhook endpoint
- For local development, expose the gateway over TLS using `ngrok`:
  ```bash
  ngrok http http://localhost:3001
  curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    --data-urlencode "url=https://<subdomain>.ngrok.app/ingress/telegram" \
    --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
  ```

### 3. Wire credentials
- Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL`, and `TELEGRAM_WEBHOOK_SECRET` environment variables before starting the gateway.

## Key Documents
- [Vision (Goal)](docs/vision.md)
- [Install Guide](docs/install.md)

## Roadmap
See `docs/vision.md` for architecture and feature details.

## Way of Working
- **Issue Lifecycle:** All work lives in GitHub Issues with acceptance criteria; the Tyrum project board tracks Backlog → Ready → In Progress → Review → Done.
- **PR Expectations:** One issue per PR, automated checks pass before review.
- **Continuous Improvement:** Retrospectives update `CONTRIBUTING.md` and `docs/` when needed.

## Contact & Support
- Discussion and planning live in GitHub Issues and the Tyrum project board.
- For urgent questions, mention the relevant owner in Issues/PRs; long-term decisions belong in `docs/` and Issues.

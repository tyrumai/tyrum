# Web Executor Sandbox

The Playwright-backed executor runs inside the `tyrum-executor-web` container.
It installs the browser runtime during the build stage and launches actions
through the gateway web-executor adapter. The container is based
on `mcr.microsoft.com/playwright`, which ships hardened Chromium, Firefox, and
WebKit builds.

Key guardrails:

- The service binds to `0.0.0.0:8091` (configurable via `WEB_EXECUTOR_BIND_ADDR`)
  and exposes `GET /healthz` plus `GET /sandbox` for quick telemetry.
- Browser processes execute in headless mode and inherit the Playwright
  namespace sandbox. The runtime drops privileges to the `pwuser` account before
  spawning Playwright, mirroring the upstream security posture.
- Cached browser assets live under `/home/pwuser/.cache`; the directory is owned
  by the non-root user to prevent privilege escalation.
- The executor module mirrors the planner contract (`Web` action primitive) and
  currently supports URL navigation plus DOM snapshots. Chromium is preferred,
  with an automatic WebKit fallback for platforms where Chromium binaries are
  unavailable (Playwright does not yet ship macOS 15 builds). Postcondition
  checks and mutating actions will land in follow-up issues (#72+).

The executor accepts the planner payload described below and currently supports:

- `url` – absolute navigation target validated by the executor.
- `fields` – array of `{ selector, value, redact? }` entries that are
  filled via Playwright’s `locator.fill` equivalent. When `redact` is set,
  the summary and DOM excerpt replace the value with `REDACTED`.
  Selectors that get promoted into `capability_memories.selectors` must strip or
  hash literal PII (emails, account numbers) before persistence.
- `submit` – `{ selector, kind?, wait_after_ms? }`. The default `kind` is
  `click`; `submit` triggers `requestSubmit` on the referenced form element.
- `snapshot_selector` (optional) – CSS selector used to capture a sanitised
  DOM excerpt (falls back to `body` when missing).

Returned outcomes include the final URL, document title, sanitised DOM excerpt
and a field summary so postconditions can assert behaviour without leaking form
data.

## Drift Handling & Retries

- The executor resolves selectors semantically before each attempt. When a
  referenced element is missing, it derives alternative selectors by
  normalising CSS attributes (e.g. `data-testid`, `name`, `aria-label`) and
  comparing them with the planner payload. Suggestions are tried sequentially
  with exponential backoff (200 ms → 400 ms → 800 ms, capped at three
  attempts).
- Each retry emits `executor_web.retry` telemetry with the attempt number and
  remaining selector candidates. Structured log events (`executor_web.retry`)
  capture the same context for audit dashboards.
- If all candidates are exhausted the executor surfaces a
  `SelectorsExhausted` error containing the retry count and the selectors that
  were attempted, allowing the planner to persist the drift in capability
  memory.

See `infra/docker-compose.yml` to boot the container as part of the local stack.

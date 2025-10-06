# Web Executor Sandbox

The Playwright-backed executor runs inside the `tyrum-executor-web` container.
It installs the browser runtime during the build stage and launches actions
through the Rust wrapper exposed by `tyrum-executor-web`. The container is based
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
- The Rust crate mirrors the planner contract (`ActionPrimitiveKind::Web`) and
  currently supports URL navigation plus DOM snapshots. Chromium is preferred,
  with an automatic WebKit fallback for platforms where Chromium binaries are
  unavailable (Playwright does not yet ship macOS 15 builds). Postcondition
  checks and mutating actions will land in follow-up issues (#72+).

The executor accepts the planner payload described in
`services/executor_web/src/lib.rs` and currently supports:

- `url` – absolute navigation target validated by the executor.
- `fields` – array of `{ selector, value, redact? }` entries that are
  filled via Playwright’s `locator.fill` equivalent. When `redact` is set,
  the summary and DOM excerpt replace the value with `REDACTED`.
- `submit` – `{ selector, kind?, wait_after_ms? }`. The default `kind` is
  `click`; `submit` triggers `requestSubmit` on the referenced form element.
- `snapshot_selector` (optional) – CSS selector used to capture a sanitised
  DOM excerpt (falls back to `body` when missing).

Returned outcomes include the final URL, document title, sanitised DOM excerpt
and a field summary so postconditions can assert behaviour without leaking form
data.

See `services/executor_web/src/lib.rs` for the executor entrypoint and
`infra/docker-compose.yml` to boot the container as part of the local stack.

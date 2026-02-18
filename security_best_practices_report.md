# Security Best Practices Review

## Executive Summary

I reviewed the TypeScript codebase with a focus on externally reachable surfaces (gateway routes, agent tool execution, and web integration paths).  
I identified **5 findings**: **1 Critical**, **3 High**, and **1 Medium**.

The most urgent risks are:
- forged Telegram webhook requests can drive agent behavior,
- high-risk agent tools are marked as requiring confirmation but are executed without approval enforcement,
- and single-instance mode can bind non-local interfaces while gateway auth remains disabled.

## Critical Findings

### CRIT-001: Telegram webhook endpoint accepts unauthenticated forged requests
- **Severity:** Critical
- **Impact:** An attacker who can reach `/ingress/telegram` can submit forged updates and trigger agent turns/replies as if they were Telegram.
- **Evidence:**
  - `packages/gateway/src/routes/ingress.ts:21` accepts raw POST body and processes it without verifying webhook authenticity.
  - `packages/gateway/src/routes/ingress.ts:61` calls `agentRuntime.turn(...)` directly on normalized input.
  - `README.md:86` webhook setup shows only URL registration; no secret-token verification mechanism is configured.
- **Why this matters:** Telegram webhooks should be authenticated (for example, via `X-Telegram-Bot-Api-Secret-Token`). Without verification, any caller can spoof Telegram traffic.
- **Recommended fix:**
  - Require a server-side secret (for example `TELEGRAM_WEBHOOK_SECRET`) and verify `X-Telegram-Bot-Api-Secret-Token` in constant time before parsing the payload.
  - Reject requests missing/invalid secret with `401`.
  - Update webhook setup to include `secret_token`.

## High Findings

### HIGH-001: Single-instance runtime can expose unauthenticated gateway routes on non-local host
- **Severity:** High
- **Impact:** If `HOST`/`SINGLE_HOST` is non-local, remote clients can access forwarded gateway routes without Bearer authentication.
- **Evidence:**
  - `web/scripts/start-single-instance.mjs:39` only logs a warning for non-local bind.
  - `web/scripts/start-single-instance.mjs:62` creates gateway app via `createApp(container)` with no `tokenStore`.
  - `packages/gateway/src/app.ts:44` applies auth middleware only when `opts.tokenStore` exists.
- **Why this matters:** This is effectively fail-open if deployment configuration drifts from localhost-only assumptions.
- **Recommended fix:**
  - Fail fast when host is non-local and auth is not configured.
  - Or always create/provide `TokenStore` in single-instance mode and enforce auth when host is non-local.

### HIGH-002: High-risk tool confirmation flags are not enforced
- **Severity:** High
- **Impact:** The model can execute high-risk tools (shell, file write, HTTP) without any approval gate despite metadata declaring confirmation is required.
- **Evidence:**
  - `packages/gateway/src/modules/agent/tools.ts:40`, `packages/gateway/src/modules/agent/tools.ts:56`, `packages/gateway/src/modules/agent/tools.ts:76`, `packages/gateway/src/modules/agent/tools.ts:98` mark dangerous tools with `requires_confirmation: true`.
  - `packages/gateway/src/modules/agent/runtime.ts:576` directly executes tool calls without checking `requires_confirmation`.
- **Why this matters:** Prompt injection or malicious user prompts can invoke sensitive actions automatically.
- **Recommended fix:**
  - Enforce confirmation in runtime execution path before calling `toolExecutor.execute(...)` for any tool with `requires_confirmation: true`.
  - Integrate with existing approvals infrastructure (pending/approve/deny flow) and default-deny on timeout.

### HIGH-003: SSRF protection for `tool.http.fetch` is vulnerable to DNS-based bypass
- **Severity:** High
- **Impact:** An attacker can potentially reach internal/private services via attacker-controlled domains that resolve to private IPs (DNS rebinding / resolution tricks).
- **Evidence:**
  - `packages/gateway/src/modules/agent/tool-executor.ts:178` checks only URL string/hostname patterns.
  - `packages/gateway/src/modules/agent/tool-executor.ts:206` allows request if hostname string is not blocked.
  - `packages/gateway/src/modules/agent/tool-executor.ts:379` performs fetch directly after string-level check.
- **Why this matters:** String-only host checks do not cover runtime DNS resolution to private ranges.
- **Recommended fix:**
  - Restrict schemes to `http`/`https`.
  - Resolve DNS before request and block all private/link-local/loopback/reserved IP results.
  - Re-check redirects and consider routing outbound traffic through an egress proxy with network policy enforcement.

## Medium Findings

### MED-001: Gateway bearer token is loaded from `NEXT_PUBLIC_*` client environment
- **Severity:** Medium
- **Impact:** If operators place a real gateway/admin token in `NEXT_PUBLIC_GATEWAY_TOKEN`, it is shipped to the browser bundle and exposed to any portal user.
- **Evidence:**
  - `web/lib/gateway-client.ts:211` reads `process.env.NEXT_PUBLIC_GATEWAY_TOKEN`.
  - `web/lib/gateway-client.ts:212` attaches it to API requests.
- **Why this matters:** `NEXT_PUBLIC_*` values are not secrets; this can turn a private admin token into public client-side data.
- **Recommended fix:**
  - Remove client-side token injection for privileged credentials.
  - Use a server-side route handler/proxy to keep sensitive tokens server-only.
  - Add documentation guardrails stating `NEXT_PUBLIC_GATEWAY_TOKEN` must never hold privileged secrets.

## Notes / Assumptions

- This review is static-analysis based on repository code and docs in this workspace.
- Default localhost-only operation lowers remote exposure, but does not eliminate risks when tunneling, non-local binds, or browser-driven localhost request paths are present.

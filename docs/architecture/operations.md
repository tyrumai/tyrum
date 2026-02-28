# Operations and onboarding

## Status

- **Status:** Partially Implemented

This document describes Tyrum’s operational model and the onboarding/diagnostics surfaces that keep deployments hardened and maintainable. Ops ergonomics are part of the architecture: if the secure configuration is hard to reach, insecure defaults tend to win in practice.

## Goals

- Make the **hardened path** the easiest path.
- Support both:
  - frictionless single-user local installations, and
  - multi-user and multi-tenant deployments with explicit access control.
- Ensure operators can quickly answer: “is this safe, is it working, and what changed?”

## Hardened-by-default onboarding

Onboarding produces a configuration that is safe without additional customization:

- Bind gateway to **loopback** by default.
- Require an auth token for all privileged HTTP/WS surfaces.
- Default tool and connector access to **deny-by-default** (or require approval) until explicitly enabled.
- Enable “secure DM mode” automatically when more than one distinct sender can reach an agent.
- Make “dangerous” settings explicit and noisy (require a typed `--i-understand` style acknowledgement in CLIs/UIs).

### Onboarding flow

Tyrum provides a guided onboarding flow (CLI/TUI and/or operator clients) that:

1. Establishes tenant context (create the first tenant or select an existing tenant) and creates the initial owner membership.
2. Configures tenant authentication (built-in auth and/or OIDC) and sets enforcement defaults.
3. Enrolls the first operator device:
   - loopback-local devices may be auto-approved when the gateway is configured for loopback-only access
   - non-local devices are enrolled via explicit approval from a trusted operator channel
4. Enrolls additional devices and nodes with explicit pairing and revocation controls.
5. Configures provider auth profiles and secret provider integration.
6. Enables a minimal set of channels/nodes (explicitly).
7. Runs a security and connectivity check.

Operator clients implement an explicit **Admin Mode** (step-up) so tenant administration actions are time-bounded and auditable.

### Operating modes

Onboarding exposes two operator-visible operating modes:

- **Local-personal:** optimized for a single-user loopback deployment, where the first local operator device may be auto-approved.
- **Remote-team:** requires explicit hardening confirmations before consent is finalized, including trusted proxy allowlists, TLS readiness, device-bound token posture, and Admin Mode step-up for tenant administration.

Remote-team mode also captures deployment intent (`single-host` vs `split-role`) and StateStore expectation (SQLite vs Postgres) so diagnostics can reason about deployment risk from day one.

## Diagnostics (“check”)

Tyrum provides a `check` surface that detects high-impact footguns and produces actionable fixes. Examples of checks:

- gateway exposed beyond loopback without TLS and without device-bound auth
- permissive tool policy on untrusted channels
- missing approvals for risky categories (network egress, filesystem writes, outbound messaging)
- unscoped policy overrides that broaden access too far
- plugin discovery enabled without an allowlist / without integrity constraints
- secret provider misconfiguration (handles fail to resolve; redaction disabled)

Check supports both:

- **static config analysis** (safe to run offline), and
- **live probes** against the running gateway (best-effort; never required for basic correctness).

### `tyrum check` output (operator-facing)

`tyrum check` prints a short, line-oriented report intended for humans and log capture.

- `static.exposure`: host/port and whether the configured bind address is loopback-only.
- `static.auth`: where the admin token is sourced from (`GATEWAY_TOKEN`, existing `.admin-token`, or generated) without printing the token value.
- `static.policy`: policy enablement and the effective policy bundle hash + sources.
- `static.plugins`: manifest discovery counts per plugin source (workspace/user/bundled), without executing plugin entry code.
- `static.secrets`: secret provider kind + basic initialization status.
- `live.http`: best-effort HTTP probes (`/healthz` and `/status`) against the configured host/port (authenticated probe is only attempted on loopback targets to avoid leaking the admin token).

## Reference deployments

Reference deployments are part of the operability contract:

- **Single host:** `docker compose` or a local process with SQLite.
- **Cluster:** Helm + HA Postgres with split roles (`gateway-edge`, `worker`, `scheduler`, `toolrunner`).

Reference deployments should be used by CI smoke tests so drift is caught early.

## Backup, restore, and incident response

Durable state and auditability are only useful if they survive incidents.

Requirements:

- Snapshot export/import for StateStore tables required to reconstruct sessions and execution.
  - Snapshot bundles declare whether artifact bytes are included (and for which sensitivity classes); operators should back up the artifact store separately when bytes are excluded.
- Artifact retention policies and export options (see [Artifacts](./artifacts.md)).
- Clear guidance on credential rotation (gateway tokens, device tokens, provider auth profiles).

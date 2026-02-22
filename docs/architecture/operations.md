# Operations and onboarding

This document describes Tyrum’s operational model and the onboarding/diagnostics surfaces that keep deployments hardened and maintainable. Ops ergonomics are part of the architecture: if the secure configuration is hard to reach, insecure defaults tend to win in practice.

## Goals

- Make the **hardened path** the easiest path.
- Provide a clear separation between:
  - **personal assistant mode** (single operator, local-first), and
  - **remote coworker / team mode** (multiple operators, remote access).
- Ensure operators can quickly answer: “is this safe, is it working, and what changed?”

## Hardened-by-default onboarding

Onboarding produces a configuration that is safe without additional customization:

- Bind gateway to **loopback** by default.
- Require an auth token for all privileged HTTP/WS surfaces.
- Default tool and connector access to **deny-by-default** (or require approval) until explicitly enabled.
- Enable “secure DM mode” automatically when more than one distinct sender can reach an agent.
- Make “dangerous” settings explicit and noisy (require a typed `--i-understand` style acknowledgement in CLIs/UIs).

### Onboarding flow

Tyrum provides a guided onboarding flow (CLI and/or gateway-served UI) that:

1. Generates or imports gateway credentials.
2. Picks an operating mode:
   - local/personal (single operator)
   - team/remote (multiple operators, device enrollment)
3. Configures provider auth profiles and secret provider integration.
4. Enables a minimal set of channels/nodes (explicitly).
5. Runs a security and connectivity check.

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

## Reference deployments

Reference deployments are part of the operability contract:

- **Single host:** `docker compose` or a local process with SQLite.
- **Cluster:** Helm + HA Postgres with split roles (`gateway-edge`, `worker`, `scheduler`, `toolrunner`).

Reference deployments should be used by CI smoke tests so drift is caught early.

## Backup, restore, and incident response

Durable state and auditability are only useful if they survive incidents.

Requirements:

- Snapshot export/import for StateStore tables required to reconstruct sessions and execution.
- Artifact retention policies and export options (see [Artifacts](./artifacts.md)).
- Clear guidance on credential rotation (gateway tokens, device tokens, provider auth profiles).

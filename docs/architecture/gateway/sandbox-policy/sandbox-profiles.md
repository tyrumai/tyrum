---
slug: /architecture/sandbox-policy/sandbox-profiles
---

# Sandbox hardening profiles

## Parent concept

- [Sandbox and Policy](/architecture/sandbox-policy)

## Scope

This page defines the concrete runtime-containment profiles Tyrum exposes to operators and to the agent runtime. It covers what each profile promises, where the guarantees come from, and how the system reports the active posture.

## Profile goals

Sandbox profiles give Tyrum a small, explicit vocabulary for execution containment:

- operators can choose a known posture instead of inferring container settings ad hoc
- the runtime can signal realistic capabilities to the model
- deployments can reason about risk without tying docs to one orchestrator

## Profiles

### `baseline`

Default conservative posture:

- workspace boundary checks
- environment sanitization
- reduced ambient privilege for subprocess or container execution
- no assumption of host-level hardening beyond Tyrum's direct controls

### `hardened`

Stronger containment for higher-risk deployments:

- all `baseline` guarantees
- tighter container or job security settings where supported
- read-only root filesystem and narrower writable mounts where feasible
- stricter process and privilege settings for ToolRunner execution

## Deployment semantics

In containerized deployments, the gateway maps the configured profile into ToolRunner job or pod settings. In local-subprocess deployments, the profile is partly declarative:

- Tyrum can enforce its own workspace and environment boundaries
- host-level hardening outside Tyrum remains operator-controlled
- the runtime should not over-claim guarantees it cannot verify locally

## Observability and signaling

The active profile is surfaced to both operators and the runtime:

- `/status` reports `sandbox.hardening_profile`
- the system prompt includes a Sandbox section so the model does not guess at containment
- execution diagnostics should include when a sandbox denial or profile-specific restriction blocked work

## Constraints

- sandboxing complements policy; it does not replace it
- a profile label is only meaningful if the runtime applies the documented controls
- profile changes are operationally significant and should be auditable in deployment change history

## Related docs

- [Sandbox and Policy](/architecture/sandbox-policy)
- [Execution engine](/architecture/execution-engine)
- [Tools](/architecture/tools)
- [Scaling and High Availability](/architecture/scaling-ha)

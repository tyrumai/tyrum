---
slug: /architecture/sandbox-policy/sandbox-profiles
---

# Sandbox hardening profiles

Read this if: you need the concrete containment vocabulary Tyrum exposes to operators and the runtime.

Skip this if: you only need the broader safety model; start with [Sandbox and Policy](/architecture/sandbox-policy).

Go deeper: [Turn Processing and Durable Coordination](/architecture/turn-processing), [Scaling and High Availability](/architecture/scaling-ha).

## Profile matrix

| Profile    | What it promises                                                                                                    | Where the limit is                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `baseline` | Workspace boundary checks, sanitized environment, reduced ambient privilege                                         | Does not assume host-level hardening beyond Tyrum-controlled settings         |
| `hardened` | All `baseline` guarantees plus tighter container/job settings, narrower writable mounts, stricter privilege posture | Guarantees depend on runtime support; local subprocess mode cannot over-claim |

## Purpose

Sandbox profiles give Tyrum a small, explicit containment vocabulary. Operators can choose a known posture, and the runtime can describe realistic constraints instead of guessing.

## Deployment semantics

- In containerized deployments, the profile maps into ToolRunner job or pod settings.
- In local-subprocess deployments, part of the profile is declarative because host hardening remains operator-controlled.
- The runtime must report the active posture honestly; a profile label is only meaningful if the documented controls are actually applied.

## Observability

- `/status` reports `sandbox.hardening_profile`.
- Runtime context can surface the active profile so the model does not invent capabilities it does not have.
- Diagnostics should show when profile-specific restrictions blocked execution.

## Related docs

- [Sandbox and Policy](/architecture/sandbox-policy)
- [Turn Processing and Durable Coordination](/architecture/turn-processing)
- [Tools](/architecture/tools)
- [Scaling and High Availability](/architecture/scaling-ha)

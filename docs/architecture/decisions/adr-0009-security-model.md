# ADR-0009: Security model (provenance, sandboxing, egress)

Status:

Accepted (2026-02-19)

## Context

Tyrum interacts with untrusted external content (web pages, tool outputs, connectors). Safety must be enforceable outside prompts (see [`docs/architecture/sandbox-policy.md`](../sandbox-policy.md)).

We need a model that works for both desktop and enterprise deployments.

## Decision

1. **Prompt/tool injection defense** uses **provenance tagging + enforceable policy**:

   - treat untrusted content as data
   - policy rules can require approvals or deny risky actions based on provenance
   - heuristics/sanitization are supplemental

2. **Sandbox baseline** is layered enforcement:

   - tool allowlists/denylists + parameter validation
   - workspace boundary enforcement
   - least-privilege process/container defaults
   - optional hardened mode for enterprise (seccomp/AppArmor/container restrictions)

3. **Network egress control** is **default-deny** for automated execution:

   - explicit domain allowlists per playbook and per deployment
   - approval-gated overrides
   - all egress is auditable
## Consequences

- We can ship safe defaults for desktop while supporting enterprise governance requirements.
- Network policy becomes a core deployment concern (compose/helm must expose configuration).

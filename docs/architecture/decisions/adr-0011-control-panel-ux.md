# ADR-0011: Control panel UX semantics

Status:

Accepted (2026-02-19)

## Context

The gateway serves a local control panel today (`/app`) and the architecture requires operator observability (runs, approvals, artifacts, nodes). Enterprise deployments need the same semantics with HA-safe state and event delivery.

Some UI semantics are still evolving; this ADR records the accepted baseline.

## Decision

1. The control panel will provide a **unified timeline** view for execution:

   - run/step/attempt lifecycle
   - approvals (requested/resolved/expired)
   - artifacts and postcondition reports

   with filters (type/status/time) and search.

2. Artifacts are **first-class** in the UX: screenshot/diff/log browsing with retention/export hooks.

3. Node management UX is explicit and least-privilege:

   - pairing flows
   - trust levels
   - per-node capability scopes
   - revocation

4. Chat/session semantics are not finalized here; by default the implementation should treat sessions as durable and keyed by routing identifiers (for example `(TyrumKey, lane)`), but a follow-up ADR may refine this.
## Consequences

- The UI must be driven by durable state + at-least-once events to work well under reconnect/HA.
- Node trust/scope changes must be audited.

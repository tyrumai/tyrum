# ADR-0012: Multi-agent routing and isolation

Status:

Accepted (2026-02-19)

## Context

Tyrum must support hosting multiple isolated agents behind one gateway while routing inbound events from channels to the correct agent (see [`docs/architecture/multi-agent-routing.md`](../multi-agent-routing.md)).

Isolation must be enforced by the gateway, not by convention.

## Decision

1. **Baseline isolation** is enforced via **hard namespaces/tenancy** in the StateStore and runtime checks:

   - workspace, sessions, memory, tools, and secrets are scoped per agent
   - cross-agent access requires explicit policy and is deny-by-default

2. **Routing rules** start as **static configuration mappings** (auditable and reversible) and can evolve to DB-stored rules editable in the control panel.

3. **Key taxonomy** follows the `TyrumKey` conventions (`packages/schemas/src/keys.ts`):

   - `channel` represents a connector/account instance (for example `telegram-main`)
   - inbound container/thread ids remain provider-native and are stored in the key’s `<id>` portion

4. **Stronger isolation mode** (future) may run agents in separate OS processes/containers for high-risk enterprise deployments.
## Consequences

- Multi-agent support requires strict scoping in every persistence path and tool boundary.
- Static routing keeps early deployments predictable while leaving room for product UX later.


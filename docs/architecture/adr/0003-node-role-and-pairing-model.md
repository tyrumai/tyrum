# ADR 0003: Node role and pairing model

- Status: Accepted
- Date: 2026-02-21

## Context

Target architecture introduces “nodes” as separate peers from operator clients:

- nodes connect with `role: node`
- nodes have stable device identities (public-key proof)
- first contact creates a pairing request
- pairing grants scoped capability authorization and can be revoked

Current repo has “capability clients” (desktop connects as a `client` and advertises capabilities) but no node role or pairing flow.

## Decision

1. Add `role` to the vNext handshake (`connect.init.payload.role`).
2. Treat `role=node` peers as “capability executors” and require pairing before they can execute `task.execute`.
3. Persist pairing requests and resolutions durably:
   - `pending → approved|denied|revoked`
   - link to stable `node_id` (derived from device public key)
4. Keep legacy capability clients temporarily:
   - behind feature flags, allow `role=client` capability execution for a deprecation window

## Rationale

- Pairing is the least-privilege safety boundary for remote device automation.
- Separating node vs client roles enables clearer access control and UI surfaces.

## Consequences

- Gateway needs pairing storage, request/resolution APIs (WS+HTTP), and events.
- Desktop app updates to connect as `role=node` and expose pairing identity.

## Rollout / rollback

- Rollout: dual-stack (legacy capability clients + new nodes); require pairing for nodes first; later tighten for capability clients.
- Rollback: disable node role feature flag; fall back to legacy capability clients.


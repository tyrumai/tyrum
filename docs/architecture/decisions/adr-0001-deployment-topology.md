# ADR-0001: Deployment topology and component roles

Status:

Accepted (2026-02-19)

## Context

Tyrum must support:

- **Desktop-embedded** deployments (single operator, localhost-only defaults, SQLite).
- **Remote/enthusiast** deployments (a remotely hosted gateway with multiple clients/nodes).
- **Enterprise/HA** deployments (replicated edges + workers + schedulers backed by HA Postgres).

The architecture documentation already assumes a single logical set of components that can be co-located or split as deployments scale (see [`docs/architecture/scaling-ha.md`](../scaling-ha.md)).

## Decision

We define **three canonical runtime roles** for containerized deployments:

- **`gateway-edge`**: WebSocket/HTTP edge, auth, contract validation, routing, and the execution engine control plane.
- **`worker`**: claims work and performs step execution (side effects) via tools/nodes/MCP.
- **`scheduler`**: cluster-safe cron/watchers/heartbeat triggers coordinated via DB leases.

Desktop-embedded installs may run these roles **co-located** (even a single OS process) with the same semantics.

We will ship:

- **Container images** that can run any of the roles (single codebase; different entrypoints/flags).
- A **docker-compose** example for enthusiast deployments.
- A **Helm chart** for enterprise deployments.

## Options considered

- **Single image, all-in-one only**: simplest packaging, but makes HA semantics and operational scaling ambiguous.
- **Two roles (`gateway-edge` + `worker`)**: reduces components, but couples scheduling coordination to the edge role and complicates independent scaling.
- **Three roles (`gateway-edge`, `worker`, `scheduler`)**: explicit responsibilities and clean scaling.
- **Fully split (edge, engine, worker, scheduler, policy, secrets)**: potentially cleaner boundaries, but adds premature operational complexity.

## Consequences

- **Pros**:
  - Aligns with the scaling model in `docs/architecture/scaling-ha.md`.
  - Supports the “desktop → enterprise” progression with one logical architecture.
  - Enables independent scaling of edges vs workers.
- **Cons**:
  - More moving parts than all-in-one; requires deployment manifests (compose/helm).


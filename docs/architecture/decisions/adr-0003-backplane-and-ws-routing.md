# ADR-0003: Event backplane and WebSocket routing

Status:

Accepted (2026-02-19)

## Context

Tyrum is **WebSocket-first**. In multi-instance deployments, a WebSocket connection is owned by exactly one gateway edge instance at a time (“WS reality”). Cross-instance delivery requires a backplane abstraction (see [`docs/architecture/scaling-ha.md`](../scaling-ha.md)).

We need:

- Durable **at-least-once** event delivery with replay on reconnect.
- Cross-instance delivery of commands/events to a client/node connected to a different edge instance.

## Decision

1. The baseline **event backplane** is **DB outbox + polling**.

   - Producers write events/commands to an outbox table in the StateStore.
   - Consumers poll and deliver.
   - Delivery is at-least-once; consumers dedupe by ids.

   Postgres `LISTEN/NOTIFY` may be added later as an optimization, but it is not required for correctness.

2. Cross-instance WebSocket routing uses a **StateStore-backed connection directory** and **directed dispatch**:

   - Each edge instance heartbeats its active connections (with TTL) and capability metadata into the StateStore.
   - When a producer needs to deliver to a specific peer, it selects the owning edge deterministically and enqueues a directed outbox command for that edge.
   - If the connection has moved/expired, delivery fails gracefully and the system retries/refreshes routing.
## Options considered

- **DB outbox + polling**: simplest durable baseline; minimal infrastructure.
- **DB outbox + Postgres `LISTEN/NOTIFY`**: good for low/medium scale; still needs an outbox for durability.
- **External pub/sub required (Redis/NATS/Kafka)**: higher ceiling but adds operational dependencies; still typically paired with an outbox.

For WS routing:

- **Edge affinity only**: pin execution to the owning edge; limits scaling and complicates worker pools.
- **Broadcast + claim**: enqueue without target and have all edges compete; inefficient and noisy.
- **Connection directory + directed dispatch**: scalable and explicit.
- **Central WS router**: adds an extra core component; premature for the baseline.

## Consequences

- The system must treat outbox delivery as **at-least-once** and implement idempotent consumers.
- The connection directory becomes a core HA mechanism and must be kept small, fast, and robust under churn.


# Protocol

Tyrum uses a typed WebSocket protocol between the gateway, clients, and nodes. The protocol is designed to be:

- **Typed:** messages are validated against contracts.
- **Bidirectional:** requests/responses plus server-push events.
- **Observable:** important state changes emit events.

The canonical wire shapes live in `@tyrum/schemas` (`packages/schemas/src/protocol.ts`).

The protocol is the primary interface for:

- interactive chat sessions
- workflow execution progress (runs/steps)
- approvals (requested/resolved) and resume control
- node pairing and capability RPC

## Transport

- Primary transport is WebSocket for low-latency, long-lived connectivity.
- Heartbeats detect dead connections and enable safe eviction/reconnect.

## Deployment notes (reconnect + dedupe)

The protocol works across gateway restarts and multi-instance deployments:

- **Reconnect is normal:** clients and nodes should tolerate disconnects and reconnect without violating safety invariants.
- **Events are at-least-once:** events may be delivered more than once (especially across reconnect). Deduplicate using `event_id`.
- **Requests can be retried:** when a peer does not observe a response, it may retry by re-sending the request with the same `request_id` (subject to each request type’s idempotency contract).
- **Durable state is the source of truth:** important state transitions must be backed by the StateStore and can be re-derived after reconnect; do not assume in-memory ordering guarantees across reconnects.

## Protocol revisions

The handshake includes a `protocol_rev` integer. A `PROTOCOL_REVISIONS` map in schemas defines the minimum and maximum supported revisions; the gateway rejects unsupported clients with a clear error. A connection is accepted only when the peer and gateway agree on the same revision.

Revision negotiation avoids big-bang client migration and lets the protocol evolve incrementally. Each revision is self-describing. `TYRUM_STRICT_HANDSHAKE` (default off) enforces new-only mode once adoption telemetry confirms legacy traffic has dropped to zero.

The protocol uses run-scoped identifiers (`run_id`, `step_id`, `attempt_id`) and avoids ambiguous plan identifiers.

## Message classes

- **Handshake:** identifies the connecting device and declares capabilities.
- **Requests/Responses:** peer-initiated actions that return a typed response.
- **Events:** gateway-emitted notifications (including server-push progress and lifecycle).

## Next

- [Handshake](./handshake.md)
- [Requests and Responses](./requests-responses.md)
- [Events](./events.md)

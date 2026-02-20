# Events

Events are gateway-emitted, server-push messages delivered to connected clients (and sometimes nodes). Events make the system observable and keep operator interfaces in sync without polling.

The canonical wire shape lives in `@tyrum/schemas` (`packages/schemas/src/protocol.ts`).

## Event envelope

- `event_id`: unique id for dedupe.
- `type`: event name (for example `run.updated`, `approval.requested`, `artifact.created`).
- `occurred_at`: timestamp.
- `scope`: routing scope (session, device, or global).
- `payload`: typed fields defined by a contract.

## Common event categories

- **Connection lifecycle:** connected/disconnected, heartbeat timeouts.
- **Pairing:** node requested/approved/denied/revoked.
- **Approvals:** requests/resolutions, expiry.
- **Execution engine:** run queued/started/paused/resumed/completed/failed; step started/completed; retries and budget events.
- **Evidence:** artifacts captured/attached; postconditions passed/failed.
- **Agent runtime:** plan/workflow selection and high-level intent updates.
- **Memory:** facts/events written, compaction, snapshots.

## Notes

- Some gateway→peer interactions are modeled as **requests** (with responses) rather than events, for example `task.execute` and `approval.request`.

## Delivery expectations

- Events are delivered **at-least-once**. Consumers must tolerate duplicates and implement idempotent handling.
- Deduplicate using `event_id` (and treat `occurred_at` as informational, not a strict ordering guarantee).
- Clients should tolerate reconnect and resubscribe without losing safety invariants; durable state in the StateStore remains the source of truth.

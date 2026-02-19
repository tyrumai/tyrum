# Events

Status:

Events are gateway-emitted, server-push messages delivered to connected clients (and sometimes nodes). Events make the system observable and keep operator interfaces in sync without polling.

The canonical wire shape lives in `@tyrum/schemas` (`packages/schemas/src/protocol.ts`).

## Event envelope (conceptual)

- `event_id`: unique id for dedupe.
- `type`: event name (for example `plan.update`, `run.updated`, `approval.resolved`).
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

- Events should be safe to handle more than once (idempotent consumption).
- Clients should tolerate reconnect and resubscribe without losing safety invariants.

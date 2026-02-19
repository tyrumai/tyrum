# Events

Status:

Events are gateway-emitted, server-push messages delivered to connected clients (and sometimes nodes). Events make the system observable and keep operator interfaces in sync without polling.

## Event envelope (conceptual)

- `event_id`: unique id for dedupe.
- `type`: event name (for example `pairing.requested`, `plan.updated`).
- `occurred_at`: timestamp.
- `scope`: routing scope (session, device, or global).
- `payload`: typed fields defined by a contract.

## Common event categories

- **Connection lifecycle:** connected/disconnected, heartbeat timeouts.
- **Pairing:** node requested/approved/denied/revoked.
- **Approvals:** human confirmation requested/resolved.
- **Agent runtime:** plan started/updated/completed/failed.
- **Memory:** facts/events written, compaction, snapshots.

## Delivery expectations

- Events should be safe to handle more than once (idempotent consumption).
- Clients should tolerate reconnect and resubscribe without losing safety invariants.

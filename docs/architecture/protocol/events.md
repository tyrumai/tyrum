# Events

Events are gateway-emitted, server-push messages delivered to connected clients (and sometimes nodes). Events make the system observable and keep operator interfaces in sync without polling.

The canonical wire shape lives in `@tyrum/schemas` (`packages/schemas/src/protocol.ts`).

## Event envelope

- `event_id`: unique id for dedupe.
- `type`: event name (for example `run.updated`, `approval.requested`, `artifact.created`, `capability.ready`, `attempt.evidence`).
- `occurred_at`: timestamp.
- `scope`: routing scope (global, agent, session key/lane, run, node, or client).
- `payload`: typed fields defined by a contract.

## Common event categories

- **Connection lifecycle:** connected/disconnected, heartbeat timeouts.
- **Presence:** gateway/client/node presence upserts, prunes, and snapshots (see [Presence](../presence.md)).
- **Pairing:** node requested/approved/denied/revoked.
- **Node capability readiness:** nodes report capability readiness (for example `capability.ready`).
- **Approvals:** requests/resolutions, expiry.
- **Execution engine:** run queued/started/paused/resumed/completed/failed; step started/completed; retries and budget events.
- **Evidence:** artifacts captured/attached; postconditions passed/failed.
- **Agent runtime:** plan/workflow selection and high-level intent updates.
- **Memory:** items written/accessed/tombstoned, consolidation runs, and budget GC outcomes.
- **Messaging UX:** typing indicators, outbound delivery receipts, and formatting fallbacks.
- **Observability:** context reports, usage snapshots, and provider quota polling status.

## Event catalog (v1)

This is the canonical list of `type` values and payload contracts for the v1 WebSocket event stream (protocol revision `2`).

### Approvals and policy

- `approval.requested` — `{ approval: Approval }`
- `approval.resolved` — `{ approval: Approval }`
- `policy_override.created` — `{ override: PolicyOverride }`
- `policy_override.revoked` — `{ override: PolicyOverride }`
- `policy_override.expired` — `{ override: PolicyOverride }`

### Execution and evidence

- `run.queued` — `{ run_id }`
- `run.started` — `{ run_id }`
- `run.paused` — `ExecutionRunPausedPayload` (pause reason + optional `approval_id`)
- `run.resumed` — `{ run_id }`
- `run.completed` — `{ run_id }`
- `run.failed` — `{ run_id }`
- `run.cancelled` — `{ run_id, reason? }`
- `run.updated` — `{ run: ExecutionRun }`
- `step.updated` — `{ step: ExecutionStep }`
- `attempt.updated` — `{ attempt: ExecutionAttempt }` (includes cost + policy decision fields when available)
- `artifact.created` — `{ artifact: ArtifactRef }`
- `artifact.attached` — `{ artifact: ArtifactRef, step_id, attempt_id }`
- `artifact.fetched` — `{ artifact: ArtifactRef, fetched_by }`

### Pairing and presence

- `pairing.requested` — `{ pairing: NodePairingRequest }`
- `pairing.approved` — `{ pairing: NodePairingRequest, scoped_token }`
- `pairing.resolved` — `{ pairing: NodePairingRequest }`
- `presence.upserted` — `{ entry: PresenceEntry }`
- `presence.pruned` — `{ instance_id }`

### Messaging UX

- `typing.started` / `typing.stopped` — `{ session_id, lane? }`
- `message.delta` — `{ session_id, lane?, message_id, role, delta }`
- `message.final` — `{ session_id, lane?, message_id, role, content }`
- `formatting.fallback` — `{ session_id, message_id, reason }`
- `delivery.receipt` — `{ session_id, lane?, channel, thread_id, status?, receipt?, error? }`

### Observability

- `auth.failed` — `WsAuthFailedEventPayload` (failed auth attempts; rate-limited; includes transport + redacted request metadata + `audit` link)
- `authz.denied` — `WsAuthzDeniedEventPayload` (authorization denials; includes token claims + required scopes + `audit` link)
- `context_report.created` — `{ run_id, report: ContextReport }`
- `usage.snapshot` — `{ scope, local.totals, provider }`
- `provider_usage.polled` — `{ result }`

### Misc

- `plan.update` — `{ plan_id, status, detail? }`
- `error` — `{ code, message }`

## Notes

- Some gateway→peer interactions are modeled as **requests** (with responses) rather than events, for example `task.execute` and `approval.request`.
- Events are **tenant-scoped**. The gateway delivers an event only to peers authenticated within the same `tenant_id`.

## Delivery expectations

- Events are delivered **at-least-once**. Consumers must tolerate duplicates and implement idempotent handling.
- Deduplicate using `event_id` (and treat `occurred_at` as informational, not a strict ordering guarantee).
- Clients should tolerate reconnect and resubscribe without losing safety invariants; durable state in the StateStore remains the source of truth.

In clustered deployments, events are delivered to the owning gateway edge via the **backplane/outbox** abstraction (see [Backplane](../backplane.md)).

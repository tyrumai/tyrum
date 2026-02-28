# Events

Events are gateway-emitted, server-push messages delivered to connected clients (and sometimes nodes). Events make the system observable and keep operator interfaces in sync without polling.

The wire shapes are defined by shared, versioned contracts (see [Contracts](../contracts.md)).

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
- **Work and delegated execution:** WorkItems and task lifecycle, WorkBoard drilldown (artifacts/decisions/signals/state KV), and subagent lifecycle.
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

- `run.queued` — `{ run_id }` (initial enqueue)
- `run.started` — `{ run_id }` (first transition to `running`)
- `run.paused` — `ExecutionRunPausedPayload` (pause reason + optional `approval_id`)
- `run.resumed` — `{ run_id }` (resume from `paused`)
- `run.completed` — `{ run_id }` (run status becomes `succeeded`)
- `run.failed` — `{ run_id }` (run status becomes `failed`)
- `run.cancelled` — `{ run_id, reason? }`
- `run.updated` — `{ run: ExecutionRun }`
- `step.updated` — `{ step: ExecutionStep }`
- `attempt.updated` — `{ attempt: ExecutionAttempt }` (includes cost + policy decision fields when available)
- `artifact.created` — `{ artifact: ArtifactRef }`
- `artifact.attached` — `{ artifact: ArtifactRef, step_id, attempt_id }`
- `artifact.fetched` — `{ artifact: ArtifactRef, fetched_by }`

### Work and delegated execution

- `work.item.created` / `work.item.updated` / `work.item.blocked` / `work.item.completed` / `work.item.cancelled` — `{ item: WorkItem }`
- `work.task.leased` — `{ work_item_id, task_id, lease_expires_at_ms }`
- `work.task.started` — `{ work_item_id, task_id, run_id }`
- `work.task.paused` — `{ work_item_id, task_id, approval_id }`
- `work.task.completed` — `{ work_item_id, task_id, result_summary? }`
- `work.artifact.created` — `{ artifact: WorkArtifact }`
- `work.decision.created` — `{ decision: DecisionRecord }`
- `work.signal.created` — `{ signal: WorkSignal }`
- `work.signal.updated` — `{ signal: WorkSignal }`
- `work.signal.fired` — `{ signal_id, firing_id, enqueued_job_id? }`
- `work.state_kv.updated` — `{ scope, key, updated_at }` (`scope` indicates `agent` or `work_item`)
- `subagent.spawned` / `subagent.updated` / `subagent.closed` — `{ subagent: Subagent }`

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
- Consumers should tolerate **unknown `type` values** (forward-compat) and ignore events they don't recognize.
- Deduplicate using `event_id` (and treat `occurred_at` as informational, not a strict ordering guarantee).
- Clients should tolerate reconnect and resubscribe without losing safety invariants; durable state in the StateStore remains the source of truth.

### Client SDK semantics

- Client SDKs emit parsed events using their wire `type` names (for example `run.updated`, `message.delta`) so operator clients do not need to parse raw WS JSON.
- Event dedupe is bounded and `event_id`-based across reconnects.
- Reconnect uses exponential backoff and preserves dedupe/replay safety guarantees across socket churn.

In clustered deployments, events are delivered to the owning gateway edge via the **backplane/outbox** abstraction (see [Backplane](../backplane.md)).

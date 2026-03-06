# Requests and Responses

Requests are typed operations initiated by either peer (gateway, client, or node). Responses are typed replies correlated by `request_id`.

The wire shapes are defined by shared, versioned contracts (see [Contracts](../contracts.md)).

## Request envelope

- `request_id`: unique id for correlation and safe retries.
- `type`: the operation name (for example `connect.init`, `task.execute`, `workflow.run`).
- `payload`: typed input fields defined by a contract.
- `trace`: optional metadata for observability (span ids, origin, timing).

## Request types

The gateway, clients, and nodes support these request types:

- `connect.init` / `connect.proof` — handshake and device proof (see [Handshake](./handshake.md)).
- `ping` — gateway heartbeat request (peer replies with `ok: true`).
- `session.send` — send a message into a session (chat input).
- `workflow.run` — start a deterministic workflow run (playbook file or inline pipeline).
- `workflow.resume` — resume a paused workflow run using a resume token (after an approval decision).
- `workflow.cancel` — cancel a queued/running/paused run (subject to policy).
- `approval.list` — list pending approvals.
- `approval.resolve` — approve/deny an approval request (idempotent; enqueues a durable engine action to resume/cancel runs asynchronously).
- `pairing.approve` / `pairing.deny` — resolve a node pairing request.
- `capability.ready` — node reports capability readiness after pairing (payload includes `CapabilityDescriptor[]`).
- `task.execute` — request a capability/tool execution for a specific attempt. Payload includes `run_id`, `step_id`, `attempt_id`, and the `ActionPrimitive`.
- `attempt.evidence` — node reports execution evidence for a specific attempt. Payload includes `run_id`, `step_id`, `attempt_id`, and evidence data for operator UIs and postconditions.

## Response envelope

- `request_id`: echoes the request id.
- `type`: echoes the operation name (useful for debugging and routing).
- `ok`: boolean success flag.
- `result`: typed output when `ok: true`.
- `error`: structured error when `ok: false` (code/message/details).

## Failure handling

Prefer explicit, typed errors over ambiguous strings:

- `contract_error` (schema validation failed)
- `unauthorized` / `forbidden`
- `not_found`
- `rate_limited`
- `internal`

For operations with side effects, idempotency should be defined up-front so clients can safely retry.

## Retry and idempotency expectations

Distributed systems lose packets and drop connections; retries are expected. Tyrum relies on two related ideas:

- **Transport-level retry (`request_id`):** if a peer does not observe a response, it may retry the same logical request by re-sending it with the same `request_id`. Servers should handle duplicate `request_id` safely according to the request type’s contract.
- **Side-effect idempotency:** for state-changing operations, the request payload (or the workflow step) may also carry an explicit `idempotency_key` so that retries do not duplicate side effects even under at-least-once execution.

### `approval.resolve` idempotency

- Resolution is an atomic state transition on the durable approval record (`pending → approved|denied|expired`).
- Only the first successful transition enqueues a durable engine action (resume/cancel). Duplicate resolve attempts for an already-resolved approval do not enqueue additional actions.
- `approval.resolved` is emitted once per approval transition, and any re-emission of that same transition reuses the persisted `event_id`; delivery is still at-least-once, so consumers should dedupe using `event_id`.

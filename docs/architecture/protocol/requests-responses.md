# Requests and Responses

Status:

Requests are typed operations initiated by either peer (gateway, client, or node). Responses are typed replies correlated by `request_id`.

The canonical wire shapes live in `@tyrum/schemas` (`packages/schemas/src/protocol.ts`).

## Request envelope (conceptual)

- `request_id`: unique id for correlation and safe retries.
- `type`: the operation name (for example `connect`, `task.execute`, `workflow.run`).
- `payload`: typed input fields defined by a contract.
- `trace`: optional metadata for observability (span ids, origin, timing).

## Current request types (implemented)

These are the operations currently implemented in the TypeScript gateway + client:

- `connect` — client→gateway handshake. Payload includes `capabilities` (and optionally `client_id`).
- `ping` — gateway→client heartbeat request (client replies with a response `ok: true`).
- `task.execute` — gateway→capable peer request to execute an `ActionPrimitive`. Payload includes `plan_id`, `step_index`, and `action`.
- `approval.request` — gateway→client request for an approval decision. Payload includes `approval_id`, `plan_id`, `step_index`, `prompt`, `context`, and optional `expires_at`.

## Common request types (target / conceptual)

- `session.send` — send a message into a session (chat input).
- `workflow.run` — start a deterministic workflow run (playbook file or inline pipeline).
- `workflow.resume` — resume a paused workflow run using a resume token (after an approval decision).
- `workflow.cancel` — cancel a queued/running/paused run (subject to policy).
- `approval.list` — list pending approvals.
- `approval.resolve` — approve/deny an approval request (may resume/cancel a run).
- `pairing.approve` / `pairing.deny` — resolve a node pairing request.

## Response envelope (conceptual)

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

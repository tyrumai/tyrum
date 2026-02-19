# Requests and Responses

Status:

Requests are client-initiated messages sent to the gateway. Responses are the gateway's typed replies.

## Request envelope (conceptual)

- `request_id`: unique id for correlation and safe retries.
- `type`: the operation name (for example `session.send`, `pairing.approve`).
- `payload`: typed input fields defined by a contract.
- `trace`: optional metadata for observability (span ids, origin, timing).

## Common request types (conceptual)

- `session.send` — send a message into a session (chat input).
- `workflow.run` — start a deterministic workflow run (playbook file or inline pipeline).
- `workflow.resume` — resume a paused workflow run using a resume token (after an approval decision).
- `workflow.cancel` — cancel a queued/running/paused run (subject to policy).
- `approval.list` — list pending approvals.
- `approval.resolve` — approve/deny an approval request (may resume/cancel a run).
- `pairing.approve` / `pairing.deny` — resolve a node pairing request.

## Response envelope (conceptual)

- `request_id`: echoes the request id.
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

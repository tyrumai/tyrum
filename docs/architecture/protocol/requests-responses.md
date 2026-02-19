# Requests and Responses

Status:

Requests are client-initiated messages sent to the gateway. Responses are the gateway's typed replies.

## Request envelope (conceptual)

- `request_id`: unique id for correlation and safe retries.
- `type`: the operation name (for example `session.send`, `pairing.approve`).
- `payload`: typed input fields defined by a contract.
- `trace`: optional metadata for observability (span ids, origin, timing).

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

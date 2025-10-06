# HTTP Executor Skeleton

The `tyrum-executor-http` crate executes planner `ActionPrimitiveKind::Http`
primitives by issuing JSON HTTP requests and validating responses against an
optional JSON Schema. The executor accepts planner arguments documented in
`services/executor_http/src/lib.rs`:

- `method` (required): HTTP method, normalised to uppercase. Supported values are `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`.
- `url` (required): Absolute URL. Hosts must be present in the outbound
  allowlist described below.
- `headers` (optional): Object mapping header names to string values. Header
  values are validated and `Authorization` entries are redacted in logs and
  planner responses.
- `body` (optional): JSON value sent as the request payload. When present, the
  executor automatically injects `Content-Type: application/json` unless the
  planner overrides it explicitly.
- `response_schema` (optional): JSON Schema used to validate the response body
  with the `jsonschema` crate (draft 2020-12). Validation failures short-circuit
  the execution and surface the joined error messages to the planner.

Successful executions return the HTTP status code, sanitised response headers,
and the parsed JSON payload. Non-success status codes are reported via the
`HttpFailure` error variant while still exposing the sanitised headers and body
for downstream observability.

## Sandbox & Outbound Policy

The executor runs in a Debian-based container listening on
`HTTP_EXECUTOR_BIND_ADDR` (default `0.0.0.0:8092`) and exposes `GET /healthz`
plus `GET /sandbox` for health checks. Outbound network access is restricted by
an allowlist resolved from `HTTP_EXECUTOR_ALLOWED_HOSTS`. The default value is
`["localhost", "127.0.0.1", "::1"]`, enforcing the localhost-only posture noted
in the issue acceptance criteria. Future integrations can expand the allowlist
via configuration; document each new domain and revisit rate limiting when
external vendors are enabled (tracked by the TODO in `lib.rs`).

## Local Development

Build the executor binary with `cargo build -p tyrum-executor-http` or start the
containerised service via `docker compose up executor-http`. The integration test
suite (`cargo test -p tyrum-executor-http`) spins up an Axum mock server to cover
success, schema-failure, and non-success status paths.

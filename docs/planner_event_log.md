# Planner Event Log

The planner emits every action trace into Postgres so that we can reconstruct plans, replay
execution, and satisfy audit requirements.

See also [`docs/planner_state_machine.md`](planner_state_machine.md) for the lifecycle and terminal
success/failure envelopes that pair with each logged action.

## API Access

The API service surfaces the audit timeline through `GET /audit/plan/{plan_id}`. The handler reads
from the `planner_events` table, returns events ordered by `step_index`, and annotates any redacted
fields so the portal can flag sanitized values.

```http
GET /audit/plan/3a1c9f77-2f6b-4f2f-a1a3-bc9471d8e852 HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json

{
  "plan_id": "3a1c9f77-2f6b-4f2f-a1a3-bc9471d8e852",
  "generated_at": "2025-10-08T18:00:12.142Z",
  "event_count": 2,
  "has_redactions": true,
  "events": [
    {
      "replay_id": "b91a7a90-239a-4f6e-9ad4-2a089dfb67d8",
      "step_index": 0,
      "occurred_at": "2025-10-08T17:58:54.327Z",
      "recorded_at": "2025-10-08T17:58:54.521Z",
      "action": {
        "kind": "executor_result",
        "result": {
          "status": "success",
          "detail": "[redacted]"
        }
      },
      "redactions": ["/action/result/detail"]
    }
  ]
}
```

When a plan has no recorded events, the endpoint responds with `404` to mirror the planner audit
contract. Payloads never expose raw PII: values detected as sensitive are replaced with `[redacted]`
before they are persisted, and the response surfaces corresponding JSON pointer paths so the UI can
display redaction badges without reading the sanitized fields.

## Storage Model
- **Table:** `planner_events`
- **Append-only:** There are no update or delete paths; the API only issues `INSERT` statements.
- **Replay identifiers:** Each entry carries a stable `replay_id` (`UUID`) chosen by the planner.
- **Ordering:** `step_index` tracks the plan-relative ordering (zero-based) and the table keeps a
  unique constraint on `(plan_id, step_index)` for fast sequential reads.
- **Payload:** The full serialized action, including parameters and execution hints, is stored as
  `JSONB` so replay tooling can hydrate planner/executor state.

```sql
CREATE TABLE planner_events (
    id BIGSERIAL PRIMARY KEY,
    replay_id UUID NOT NULL,
    plan_id UUID NOT NULL,
    step_index INTEGER NOT NULL CHECK (step_index >= 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    action JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Dedupe Guard
Duplicate ingest attempts (for example, planner retries after a network blip) reuse the same
`replay_id`. The schema enforces uniqueness on that column and the Rust facade returns
`AppendOutcome::Duplicate` so callers can log idempotent attempts without writing another row.

We also ensure `step_index` monotonically increases for a plan by enforcing `CHECK step_index >= 0`
and `UNIQUE(plan_id, step_index)`. The read path always orders by `step_index` for deterministic
replay.

## Service Integration
`tyrum-planner` exposes `EventLog` which:
1. Runs migrations (`EventLog::migrate`) during bootstrap to ensure the table exists.
2. Provides `append` to insert entries with idempotent handling.
3. Exposes `events_for_plan` to stream traces back when deriving audit or replay artefacts.

## Replay Sandbox Workflow
- The binary `replay_sandbox` replays recorded planner steps to detect executor drift and postcondition regressions.
- Usage (also printed by `cargo run -p tyrum-planner --bin replay_sandbox -- --help`):

  ```
  replay_sandbox --plan-id <UUID> --database-url <postgres-url> [--subject-id <UUID>] [--output-dir <dir>]
  ```

- `--subject-id` is optional but recommended so the sandbox can repopulate Tyrum memory with episodic events and capability facts during replay.
- Metrics `replay.steps_total` and `replay.failures_total` are emitted via OpenTelemetry for each run when instrumentation is enabled.
- On divergence the command exits non-zero and writes a markdown summary to `artifacts/replay/<plan-id>.md`, detailing executors, expected vs actual results, and JSON pointer diffs.

## Capability Memory Hydration
- Before dispatching any mutating primitive, the planner consults the capability memory store using a
  connection shared with the event log (via `CapabilityMemoryService`).
- Each lookup emits a `planner.capability_memory.lookup` span capturing `subject_id`,
  `capability_identifier`, `executor_kind`, `hit` (true/false), and `latency_ms`.
- When a lookup hits, the planner merges the stored `selectors` into the primitive's `selector_hints`
  (without overwriting caller-provided hints) and attaches a `capability_memory` payload containing
  the latest `success_count`, `last_success_at`, `outcome_metadata`, and `result_summary`.
- Misses leave the primitive unchanged, but the span still records `hit=false` so telemetry consumers
  can track cache effectiveness.

Unit tests spin up an ephemeral Postgres container to assert insertion, dedupe, ordering, and
validation of step indices. They run as part of `cargo test --all --all-targets` via the
`pre-commit` hook.

## Troubleshooting Policy Denials
- Negative policy decisions land in the event log as a `failure` outcome with a sanitized
  `detail` string that describes the triggering rule (for example, `SpendLimit`) without exposing
  raw spend thresholds.
- The `policy.rules[].detail` fields are scrubbed of digits before persisting so audit trails stay
  actionable while avoiding leakage of configurable caps.
- Wallet authorizations record a `wallet` audit block with sanitized reasons and append the
  `Spend guardrail enforced by wallet authorization.` note so reviewers can trace guardrail
  enforcement without revealing raw spend amounts or card metadata.
- Use `cargo test -p tyrum-planner policy_denial` to run the regression harness that exercises the
  denial flow and ensures both the planner response and audit payloads include the reason string.

## Troubleshooting Executor Failures
- Executor and postcondition faults raise `PlanFailureReason::ExecutorFailed` with the failing
  `step_index` so responders can identify which primitive stalled.
- Planner responses surface the same detail string, while the event log writes a `failure` outcome
  block containing the error `code`, sanitized `detail`, and `retryable` flag for downstream replay.
- Inspect the audit row with `SELECT outcome FROM planner_events WHERE plan_id = ?` to confirm the
  failure metadata propagated end-to-end; the `code` should match the wire error (`internal` or
  `executor_unavailable`).
- Run `cargo test -p tyrum-planner failure_propagation` to exercise the regression harness that asserts
  executor failures keep the `step_index` and detail intact across planner surfaces.

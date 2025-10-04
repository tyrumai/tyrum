# Planner Event Log

The planner emits every action trace into Postgres so that we can reconstruct plans, replay
execution, and satisfy audit requirements.

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

Unit tests spin up an ephemeral Postgres container to assert insertion, dedupe, ordering, and
validation of step indices. They run as part of `cargo test --all --all-targets` via the
`pre-commit` hook.

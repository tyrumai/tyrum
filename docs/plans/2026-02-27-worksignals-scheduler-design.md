# WorkSignals Scheduler/Watchers Design

**Goal:** Implement durable, dedupe-safe evaluation + firing of **WorkSignals** (prospective memory) in the gateway, focusing on **event-based** triggers first. A firing must be durable across restarts, must not double-fire on replay/reconnect, and must emit `work.signal.fired` with stable identifiers.

## Scope (v1)

- Event-based triggers (first pass): WorkItem status transitions
  - Example: WorkItem enters `blocked|done|failed|cancelled`
- On fire:
  - Create a durable firing record (dedupe-safe).
  - Mark the signal fired (durable, prevents repeat).
  - Emit `work.signal.fired` with stable identifiers.
  - Enqueue explicit follow-up work by creating a `work_item_tasks` row for the owning WorkItem (when present).

## Non-goals (v1)

- A full trigger DSL for all examples in #631 (approvals, artifacts, task completion). The design keeps the storage format open (`trigger_spec_json`) but ships one trigger kind first.
- Executing the follow-up work. v1 only creates a durable task record; later work can lease + run these tasks.
- Time-zone/local-time scheduling for time-based signals.

## Proposed approaches

1) **DB-backed polling scheduler (recommended)**
   - Periodic tick queries durable state (work item events) and derives firings.
   - Pros: simplest path to “survives restarts”, easy to test deterministically (`tick()`), no need to thread event subscriptions through many modules.
   - Cons: latency bounded by tick interval; queries must be bounded.

2) **Event subscription + in-memory evaluation**
   - Subscribe to internal events (work item transitions, approvals, artifacts) and fire immediately.
   - Pros: low latency.
   - Cons: more invasive wiring; restart safety still needs durable dedupe/firing state.

3) **Hybrid**
   - Subscribe for fast-path + periodic reconciliation poller.
   - Pros: best reliability + latency.
   - Cons: more moving parts (YAGNI for v1).

## Architecture (v1)

### Trigger spec (event-based, v1)

For v1, support a single event trigger spec:

```json
{
  "kind": "work_item.status.transition",
  "to": ["blocked", "done", "failed", "cancelled"]
}
```

- The WorkItem id is taken from `work_signals.work_item_id` (required for this trigger kind).
- The spec is validated at runtime; invalid specs are ignored (best-effort).

### Durable firing record

Add a new table `work_signal_firings` (SQLite + Postgres) to track firings with:

- DB-lease fields (`lease_owner`, `lease_expires_at_ms`) for cluster safety.
- `attempt` + `next_attempt_at_ms` for bounded retries with backoff.
- `dedupe_key` to guarantee at-most-once per signal + causal event.

For WorkItem status transition triggers, `dedupe_key = work_item_events.event_id`.

### Scheduler / processor loop

Add `WorkSignalScheduler` (patterned after `WatcherScheduler`):

- `tick()`:
  1. Query active WorkSignals (`status = 'active'`, `trigger_kind = 'event'`).
  2. For each signal, query bounded `work_item_events` since `signal.created_at` and find the first matching status transition.
  3. Create a durable firing row using `(signal_id, dedupe_key)` uniqueness.
  4. Claim and process queued firings using DB leases and retry/backoff.

### On firing (processing step)

Processing a claimed firing:

1. Re-read the firing row and the signal row to confirm:
   - firing is still `processing`
   - lease_owner matches this scheduler instance
   - signal is still `active`
2. Mark the signal fired (`status='fired'`, `last_fired_at=now`).
3. If the signal has a `work_item_id`, create a `work_item_tasks` row to represent explicit follow-up work (execution wiring can come later).
4. Mark the firing row `enqueued` with any metadata (error cleared).
5. Emit `work.signal.fired` to WS operator clients with:
   - `signal_id`
   - `firing_id` (stable; derived from signal + dedupe key)
   - `enqueued_job_id` (omitted in v1 unless we later wire a real job)

### Idempotency and correctness

- **At-most-once:** enforced by `UNIQUE(signal_id, dedupe_key)` + durable signal status flip to `fired`.
- **No double-fire on replay:** the same causal event produces the same dedupe key, so a second evaluation creates no new firing.
- **Cluster safety:** DB leases prevent two schedulers from processing the same firing concurrently.
- **Retries/backoff:** failures re-queue with exponential backoff until `maxAttempts`, then mark `failed`.

## Rollback

- Disable scheduler startup (feature flag/env) while leaving persistence intact.
- If needed, revert the migration that adds `work_signal_firings` and remove scheduler wiring; WorkSignal CRUD remains unaffected.

## Test plan

- Unit tests:
  - A WorkSignal with `work_item.status.transition` fires when the WorkItem transitions to `blocked` and emits exactly one `work.signal.fired`.
  - Restart safety: creating a second scheduler instance does not re-fire.
- Contract/conformance:
  - Add a WS contract test that drives `work.create` + `work.signal.create` + `work.transition` and asserts the emitted `work.signal.fired` frame conforms to `@tyrum/schemas`.


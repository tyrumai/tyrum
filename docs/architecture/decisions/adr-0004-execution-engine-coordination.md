# ADR-0004: Execution engine persistence and coordination

Status:

Accepted (2026-02-19)

## Context

The execution engine is responsible for resilient, auditable execution (retries, idempotency, pause/resume, evidence) across single-host and HA deployments (see [`docs/architecture/execution-engine.md`](../execution-engine.md)).

The repository already contains:

- A richer execution contract in `@tyrum/schemas` (`packages/schemas/src/execution.ts`).
- A simplified SQLite `jobs` table (`packages/gateway/migrations/011_jobs.sql`) used by the current in-process runner.

To support HA workers, we need a durable data model and explicit coordination primitives.

## Decision

1. **Canonical persistence model**

   Persist execution using normalized tables aligned to the `@tyrum/schemas` execution contracts:

   - `ExecutionJob`
   - `ExecutionRun`
   - `ExecutionStep`
   - `ExecutionAttempt` (including artifacts + postcondition reports)

   The current simplified `jobs`/`plan_id` model is transitional.

2. **Worker claim/lease**

   Use explicit **lease columns** (`lease_owner`, `lease_expires_at`) on claimable work items, claimed via atomic updates, renewed periodically, and safely taken over on expiry.

3. **Lane serialization**

   Enforce `(TyrumKey, lane)` exclusivity using **lane lease rows** keyed by `(key, lane)` with expiry/renew/takeover.

4. **Scheduler coordination**

   Use DB leases for schedulers and ensure each firing has a durable unique `firing_id` so downstream enqueue/execution can dedupe.

5. **Retry policy**

   Use a **per-step retry policy** with conservative defaults. Side-effecting steps must only retry automatically when idempotency is enforced.

6. **Idempotency**

   Enforce **durable dedupe with cached outcomes**: duplicate `(scope, kind, idempotency_key)` returns the prior stored result instead of re-executing the side effect.

7. **Unverifiable outcomes**

   Do **not** add new terminal statuses. Model “unverifiable” as a **pause** (typically for approval/takeover) with stored reports/errors indicating missing evidence, blocking dependent steps.

8. **Postconditions**

   Maintain a small explicit core set of postcondition assertion kinds and support extension via plugin/connector registration (no arbitrary expression evaluation).

9. **Rollback metadata**

   Keep human-readable rollback hints and support optional structured compensation actions, always approval-gated.

10. **Concurrency limits**

   Support hierarchical limits: global + per-agent + per-lane + per-capability/provider.

11. **Pause/resume tokens**

   Store paused state in the StateStore and use **opaque resume tokens** (random id → DB row) with expiry and revocation.
## Consequences

- This model provides a stable path to HA workers without changing user-facing semantics across deployment tiers.
- It increases schema complexity but reduces hidden coupling and “magic” behavior.

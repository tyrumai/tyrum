# WorkSignals Scheduler/Watchers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a DB-backed WorkSignals scheduler/watchers implementation that reliably fires event-based signals across restarts, records durable + deduped firings, emits `work.signal.fired`, and enqueues explicit follow-up work.

**Architecture:** Introduce a `work_signal_firings` table (dedupe + DB-lease + retry/backoff), a `WorkSignalScheduler` that polls for eligible signals + causal events and processes queued firings, and a shared WS broadcast helper so both protocol handler and scheduler can emit `work.signal.*` events consistently.

**Tech Stack:** Node.js (TypeScript, ESM), SQLite/Postgres migrations, Vitest, `@tyrum/schemas` WS envelopes.

---

### Task 1: Add durable `work_signal_firings` persistence

**Files:**

- Create: `packages/gateway/migrations/sqlite/028_work_signal_firings.sql`
- Create: `packages/gateway/migrations/postgres/028_work_signal_firings.sql`
- Modify: `packages/gateway/tests/contract/schema-contract.test.ts`
- Modify: `packages/gateway/tests/unit/workboard-migrations.test.ts`

**Step 1: Write the failing test**

- Update the table allowlist to include `work_signal_firings`.
- Run the existing schema/migrations contract tests.

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/gateway/tests/contract/schema-contract.test.ts`
Expected: FAIL (missing `work_signal_firings` in DB schema).

**Step 3: Write minimal implementation**

- Add the migration creating `work_signal_firings` with:
  - `firing_id` (PK)
  - `signal_id` (FK → `work_signals`)
  - `dedupe_key` (`UNIQUE(signal_id, dedupe_key)`)
  - status (`queued|processing|enqueued|failed`)
  - attempt + `next_attempt_at_ms`
  - lease owner + expiry
  - error + timestamps

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/gateway/tests/contract/schema-contract.test.ts`
Expected: PASS.

**Step 5: Commit**

Run:

```bash
git add packages/gateway/migrations/sqlite/028_work_signal_firings.sql packages/gateway/migrations/postgres/028_work_signal_firings.sql packages/gateway/tests/contract/schema-contract.test.ts packages/gateway/tests/unit/workboard-migrations.test.ts
git commit -m "feat(gateway): add work_signal_firings persistence"
```

---

### Task 2: Implement WorkSignal firing DAL + scheduler

**Files:**

- Create: `packages/gateway/src/modules/workboard/signal-firing-dal.ts`
- Create: `packages/gateway/src/modules/workboard/signal-scheduler.ts`
- Modify: `packages/gateway/src/index.ts`

**Step 1: Write the failing test**

- Add a unit test that:
  1. Creates a WorkItem.
  2. Creates a WorkSignal attached to that WorkItem with `trigger_kind='event'` and `trigger_spec_json.kind='work_item.status.transition'`.
  3. Transitions the WorkItem to `blocked`.
  4. Runs `WorkSignalScheduler.tick()` and asserts exactly one firing is created and the signal becomes `fired`.
  5. Runs a second scheduler instance tick and asserts no duplicate firing/event.

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/gateway/tests/unit/worksignals-scheduler.test.ts`
Expected: FAIL (scheduler/DAL not implemented).

**Step 3: Write minimal implementation**

- Add `WorkSignalFiringDal` (patterned after `WatcherFiringDal`) with:
  - `createIfAbsent({ firingId, signalId, dedupeKey, scheduledAtMs })`
  - `claimNext({ owner, nowMs, leaseTtlMs })` respecting `next_attempt_at_ms`
  - `markEnqueued(...)`
  - `markRetryableFailure(...)` with exponential backoff + max attempts
- Add `WorkSignalScheduler` with:
  - `tick()` that:
    - lists active `work_signals` rows
    - evaluates the v1 trigger against `work_item_events(kind='status.transition')`
    - creates firings deterministically (stable firing_id)
    - claims + processes queued firings
  - processing marks the signal fired and creates a `work_item_tasks` row (explicit follow-up work)
  - emits `work.signal.fired` via a WS broadcast helper using the gateway connection manager.
- Wire scheduler startup in `packages/gateway/src/index.ts` (role `all|scheduler`).

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/gateway/tests/unit/worksignals-scheduler.test.ts`
Expected: PASS.

**Step 5: Commit**

Run:

```bash
git add packages/gateway/src/modules/workboard/signal-firing-dal.ts packages/gateway/src/modules/workboard/signal-scheduler.ts packages/gateway/src/index.ts packages/gateway/tests/unit/worksignals-scheduler.test.ts
git commit -m "feat(gateway): fire WorkSignals on work item transitions"
```

---

### Task 3: Add WS conformance coverage for one WorkSignal trigger

**Files:**

- Modify: `packages/gateway/tests/contract/ws-contract-conformance.test.ts`

**Step 1: Write the failing test**

- Extend the contract test to:
  - connect a real `TyrumClient`
  - create a WorkItem via WS (`work.create`)
  - create a WorkSignal attached to that item (`work.signal.create`)
  - transition the item to `blocked` (`work.transition`)
  - wait for a `work.signal.fired` event frame
  - validate it with `WsWorkSignalFiredEvent.parse(...)`

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/gateway/tests/contract/ws-contract-conformance.test.ts`
Expected: FAIL (no `work.signal.fired` frame emitted yet).

**Step 3: Write minimal implementation**

- Ensure scheduler emits `work.signal.fired` to operator clients (and outbox when cluster is configured).

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/gateway/tests/contract/ws-contract-conformance.test.ts`
Expected: PASS.

**Step 5: Commit**

Run:

```bash
git add packages/gateway/tests/contract/ws-contract-conformance.test.ts
git commit -m "test(gateway): cover WorkSignal fired WS event"
```

---

### Final verification (required before PR)

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format
```

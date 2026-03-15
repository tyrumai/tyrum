---
slug: /architecture/index-tuning
---

# Index tuning loop

Tyrum’s v2 schema ships with a solid baseline index set, but real-world query patterns evolve. This runbook defines a lightweight loop for proposing and validating index changes.

## Checklist

1. **Capture the hot query**
   - Record the exact SQL and the call site (file + function).
   - Note cadence and cardinality (e.g., “runs every second”, “per session”, “per tenant”).

2. **Measure the baseline**
   - **SQLite:** run `EXPLAIN QUERY PLAN <SQL>` (and optionally time a representative query loop). For reproducible “explicit index” validation, temporarily set `PRAGMA automatic_index = OFF`.
   - **Postgres:** run `EXPLAIN (ANALYZE, BUFFERS) <SQL>` on representative data.

3. **Propose an index**
   - Add a new numbered migration in both:
     - `packages/gateway/migrations/sqlite/`
     - `packages/gateway/migrations/postgres/`
   - Keep index names consistent across dialects.
   - Include a short justification comment tying the index to the measured query.

4. **Verify improvement**
   - Confirm the planner uses the new index and eliminates avoidable sorts/scans.
   - Add a regression test when practical (for example: assert `EXPLAIN QUERY PLAN` uses the index on SQLite).

5. **Rollout / rollback**
   - Roll forward with an index-add migration.
   - Roll back by adding a follow-up migration that drops the index (avoid editing applied migrations).

## Example: `channel_outbox` inbox ordering

`ChannelOutboxDal` frequently needs rows ordered by `(chunk_index, outbox_id)` for a single `inbox_id` (list + claim loops). Call sites include `packages/gateway/src/modules/channels/outbox-dal.ts` (`listForInbox`, `claimNextForInbox`). We added an index to avoid a full scan and temp sort.

- Migration:
  - `packages/gateway/migrations/sqlite/105_channel_outbox_inbox_chunk_order_idx.sql`
  - `packages/gateway/migrations/postgres/105_channel_outbox_inbox_chunk_order_idx.sql`
- Regression test: `packages/gateway/tests/contract/index-tuning-loop.test.ts`

SQLite evidence (`EXPLAIN QUERY PLAN` for `WHERE inbox_id = ? ORDER BY chunk_index, outbox_id LIMIT 1`, collected with `PRAGMA automatic_index = OFF`):

```text
# Before (without 105_* migration)
SCAN channel_outbox
USE TEMP B-TREE FOR ORDER BY

# After (with 105_* migration)
SEARCH channel_outbox USING COVERING INDEX channel_outbox_inbox_chunk_outbox_idx (inbox_id=?)
```

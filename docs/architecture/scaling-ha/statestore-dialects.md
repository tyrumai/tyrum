---
slug: /architecture/gateway/statestore-dialects
---

# StateStore dialects (SQLite vs Postgres)

This is a reference page for the small set of intentional schema differences between SQLite and Postgres.

## Quick orientation

- **Read this if:** you are adding schema or DAL code and need to know where dialect differences are allowed.
- **Skip this if:** you only need the deployment model; start with [Scaling and High Availability](/architecture/scaling-ha).
- **Go deeper:** see [DB naming conventions](/architecture/db-naming-conventions) and [Postgres JSON fields](/architecture/gateway/postgres-json-fields).

## Dialect matrix

| Concern                       | SQLite                     | Postgres                | Rule of thumb                                                        |
| ----------------------------- | -------------------------- | ----------------------- | -------------------------------------------------------------------- |
| IDs                           | `TEXT`                     | `UUID`                  | Keep logical shapes aligned; hide differences in statestore helpers. |
| Booleans                      | `INTEGER` (`0/1`)          | `BOOLEAN`               | Bind through helpers, not inline `db.kind` branches.                 |
| Wall-clock timestamps         | `TEXT` + `datetime('now')` | `TIMESTAMPTZ` + `now()` | Normalize on read.                                                   |
| Millisecond epochs / counters | `INTEGER`                  | `BIGINT`                | Use for leases, expiry, monotonic counters, and retry timing.        |
| JSON-heavy payloads           | usually `TEXT`             | usually `TEXT`          | Prefer portability unless a proven Postgres-only query need exists.  |

## Allowed divergence

The divergence list should stay short. Add a new dialect difference only when one of these is true:

| Allowed reason                                               | Example                                               |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Native type materially improves correctness                  | `UUID`, `BOOLEAN`, `TIMESTAMPTZ` on Postgres          |
| SQLite portability would become meaningfully worse otherwise | JSON payloads kept as `TEXT`                          |
| The divergence can be centralized in the statestore layer    | helper-based parameter binding and read normalization |

## Rules for implementation

- Prefer parameterized SQL and DAL helpers over feature-level dialect branching.
- Centralize differences under `packages/gateway/src/statestore/`.
- Normalize timestamps on read through `packages/gateway/src/utils/db-time.ts`.
- If a new divergence is introduced, document it here and keep the migration names aligned across both dialects.

## Existing helper touchpoints

| Helper                     | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `sqlBoolParam(db, value)`  | Bind booleans without inline SQLite/Postgres branching. |
| `sqlActiveWhereClause(db)` | Build dialect-safe `watchers.active` predicates.        |

## Related docs

- [Scaling and High Availability](/architecture/scaling-ha)
- [Postgres JSON fields: JSONB vs TEXT](/architecture/gateway/postgres-json-fields)
- [DB naming conventions](/architecture/db-naming-conventions)
- [DB JSON hygiene](/architecture/db-json-hygiene)

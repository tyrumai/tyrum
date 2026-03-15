---
slug: /architecture/gateway/statestore-dialects
---

# StateStore dialects (SQLite vs Postgres)

Tyrum supports SQLite (default) and Postgres for the gateway StateStore. To keep the SQLite path lightweight while still using native Postgres types where they matter, the schemas intentionally diverge in a few places.

## Intentional type divergences

This list is intentionally short. If you add a new divergence, add it here and centralize any dialect handling in `packages/gateway/src/statestore/`.

- **IDs:** `TEXT` (SQLite) vs `UUID` (Postgres)
- **Booleans:** `INTEGER` (`0/1`) (SQLite) vs `BOOLEAN` (Postgres)
- **Timestamps:** `TEXT` + `datetime('now')` (SQLite) vs `TIMESTAMPTZ` + `now()` (Postgres)
- **Millisecond epochs / counters:** `INTEGER` (SQLite) vs `BIGINT` (Postgres)

## Guidelines

- Prefer **parameterized SQL** and avoid branching on `db.kind` in feature modules.
- Centralize dialect differences in small helpers under `packages/gateway/src/statestore/`.
- When reading timestamps, normalize them (see `packages/gateway/src/utils/db-time.ts`).

## Helpers

- `packages/gateway/src/statestore/sql.ts` exports:
  - `sqlBoolParam(db, value)` for binding boolean-ish parameters (`true/false` vs `1/0`)
  - `sqlActiveWhereClause(db)` for building the `watchers.active` predicate without inline dialect conditionals

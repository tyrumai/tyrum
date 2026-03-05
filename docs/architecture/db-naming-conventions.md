# DB naming conventions

This document defines naming conventions for StateStore tables and migration SQL, with the goal of keeping SQLite and Postgres schemas aligned and reducing drift.

## Primary keys (PK)

- **Tenant-scoped entities:** prefer composite PKs: `(tenant_id, <entity>_id)` (UUID in Postgres; `TEXT` in SQLite).
- **Surrogate/auto-increment PKs:** use `<table>_id` (not generic `id`) when the value is returned to callers or used in DAL queries.
- **Consistency rule:** the PK column name for a table must be the same in both dialects (SQLite + Postgres).

## Foreign keys (FK)

- Name FK columns after the referenced PK column: `<ref_table>_id`.
- For tenant-scoped references, include `tenant_id` in the FK columns (and in the referenced key) to prevent cross-tenant linkage.

## Timestamps

- Use `created_at` / `updated_at` for wall-clock timestamps (`TIMESTAMPTZ` on Postgres; `TEXT` in SQLite).
- Use `*_at_ms` for millisecond epoch timestamps (`BIGINT` on Postgres; `INTEGER` in SQLite).

## Migration checklist

When adding or modifying migrations under `packages/gateway/migrations/*`:

- Apply the same schema changes in both `sqlite/` and `postgres/`.
- Keep PK/FK/timestamp column names consistent with the conventions above.
- Run the schema contract test: `pnpm test packages/gateway/tests/contract/schema-contract.test.ts`.

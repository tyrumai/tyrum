# Postgres JSON fields: JSONB vs TEXT (issue #983)

## Context

Tyrum supports SQLite (default) and Postgres for the gateway StateStore. Many columns store JSON payloads as `TEXT` to keep the schema and application code portable across both engines.

This note evaluates whether we should use Postgres-native `JSONB` / generated columns for a small set of “high-value” JSON columns.

## Columns evaluated

Representative JSON-heavy columns called out in the issue:

- `policy_snapshots.bundle_json`
- `routing_configs.config_json`
- `watchers.trigger_config_json`

## Findings (today)

- These columns are primarily **read by ID/revision** and then parsed/validated in the gateway; they are **not currently queried by JSON path** in hot operator queries.
- Postgres `JSONB` would improve queryability, but it also introduces practical costs:
  - `pg` returns `json/jsonb` columns as native JS values, which would require dialect handling across the DALs.
  - `JSONB` does not preserve input formatting/key order, which can change any logic that hashes or otherwise relies on the stored textual representation.

## Decision

Keep these columns as `TEXT` for now, and treat Postgres JSON querying as an **opt-in query-layer optimization** (cast-to-`jsonb`, expression/partial indexes) when we have a demonstrated query use-case.

As an immediate integrity win, enforce that these “high-value” `TEXT` JSON columns contain valid JSON:

- SQLite: `CHECK (json_valid(...))`
- Postgres: `CHECK (pg_input_is_valid(..., 'jsonb'))`

## Notes

- The JSON-validity `CHECK` constraints are implemented in the v2 rebuild migrations (`100_rebuild_v2.sql`), so existing databases that already applied v2 migrations will not pick them up unless rebuilt.
- The Postgres checks rely on `pg_input_is_valid` and are validated against the repo’s development baseline (`docker-compose.yml` uses `postgres:16`).

## Revisit criteria

Re-evaluate a `JSONB`-native column (or generated columns) when:

- The operator UI/audits need filtering on specific JSON keys, and
- We can point to a concrete query pattern worth indexing.

At that point, prefer:

1. **Expression/partial indexes** on `(text_column::jsonb ->> 'key')` for Postgres-only performance.
2. **Generated columns** only if expression indexes are insufficient and we are willing to keep schema parity (or explicitly document divergence).
3. **`JSONB` column types** only with explicit dialect handling in `packages/gateway/src/statestore/` and documentation in `docs/architecture/gateway/statestore-dialects.md`.

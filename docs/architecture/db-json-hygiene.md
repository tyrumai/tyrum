# DB JSON hygiene

Tyrum stores many `*_json` columns as **JSON text** (cross-database, simple migrations).

## Canonical shapes + NULLability

The canonical expectations for every `*_json` column (shape, whether `NULL` is allowed, and the DB default when present) live in:

- `packages/gateway/src/statestore/json-columns.json`

This spec is enforced by contract tests:

- `packages/gateway/tests/contract/json-column-specs.test.ts` (SQLite schema vs spec)
- `packages/gateway/tests/contract/json-column-defaults-aligned.test.ts` (Postgres rebuild migration vs spec defaults)

## Conventions

- **shape = `object`**: JSON object (`{...}`), default (when present) is `{}`.
- **shape = `array`**: JSON array (`[...]`), default (when present) is `[]`.
- **shape = `any`**: any JSON value; callers must validate as needed.

## When changing the schema

When adding/changing a `*_json` column:

1. Update the SQLite + Postgres migrations.
2. Update `packages/gateway/src/statestore/json-columns.json`.
3. Run `pnpm test` (or at least the relevant contract tests).

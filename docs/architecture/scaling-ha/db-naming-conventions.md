---
slug: /architecture/db-naming-conventions
---

# DB naming conventions

This is a compact reference card for StateStore schema naming. The goal is alignment across SQLite and Postgres and less drift in DAL code.

## Quick orientation

- **Read this if:** you are adding tables, keys, timestamps, or migrations.
- **Skip this if:** you only need the conceptual data model.
- **Go deeper:** use [StateStore dialects](/architecture/gateway/statestore-dialects) for allowed type divergence.

## Naming matrix

| Concern                           | Convention                                  | Why                                                                 |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| Tenant-scoped primary keys        | `(tenant_id, <entity>_id)`                  | Prevent cross-tenant linkage and keep composite ownership explicit. |
| Surrogate ids returned to callers | `<table>_id`, not generic `id`              | Makes DALs and joins clearer.                                       |
| Foreign keys                      | Match the referenced PK column name         | Lowers join ambiguity and migration drift.                          |
| Tenant-scoped foreign keys        | Include `tenant_id` in both sides of the FK | Enforces tenant isolation in the schema.                            |
| Wall-clock timestamps             | `created_at`, `updated_at`                  | Stable semantic clock across both dialects.                         |
| Millisecond epoch timestamps      | `*_at_ms`                                   | Clear distinction for lease/expiry counters.                        |

## Timestamp rule

`updated_at` is a semantic mutation clock:

- write it on every real row change,
- leave it alone on no-op writes,
- prefer compare-and-update DAL helpers instead of depending on DB defaults alone.

## Migration checklist

When touching `packages/gateway/migrations/*`:

1. Apply the same schema change in `sqlite/` and `postgres/`.
2. Keep PK, FK, and timestamp names aligned with this page.
3. Run the schema contract test: `pnpm test packages/gateway/tests/contract/schema-contract.test.ts`.

## Related docs

- [StateStore dialects](/architecture/gateway/statestore-dialects)
- [DB enum constraints](/architecture/db-enum-constraints)
- [Gateway data model map (v2)](/architecture/data-model-map)

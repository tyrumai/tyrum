---
slug: /architecture/db-json-hygiene
---

# DB JSON hygiene

This is a compact reference card for how Tyrum stores and validates `*_json` columns.

## Quick orientation

- **Read this if:** you are adding or changing a JSON column in the StateStore.
- **Skip this if:** you only need the high-level dialect decision.
- **Go deeper:** use [Postgres JSON fields](/architecture/gateway/postgres-json-fields) for the `TEXT` vs `JSONB` decision.

## Source of truth

| Artifact                                                               | Purpose                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/gateway/src/statestore/json-columns.json`                    | Canonical shape, nullability, and default policy for every `*_json` column. |
| `packages/gateway/tests/contract/json-column-specs.test.ts`            | Checks SQLite schema against the spec.                                      |
| `packages/gateway/tests/contract/json-column-defaults-aligned.test.ts` | Checks Postgres rebuild defaults against the spec.                          |

## Shape rules

| Shape    | Meaning              | Default when present   |
| -------- | -------------------- | ---------------------- |
| `object` | JSON object          | `{}`                   |
| `array`  | JSON array           | `[]`                   |
| `any`    | Any valid JSON value | no shared default rule |

## Change checklist

1. Update the SQLite migration.
2. Update the Postgres migration.
3. Update `json-columns.json`.
4. Run the relevant contract tests.

## Rule of thumb

Keep JSON columns boring:

- cross-dialect,
- schema-documented,
- validity-checked,
- and validated again at the application boundary.

## Related docs

- [Postgres JSON fields: JSONB vs TEXT](/architecture/gateway/postgres-json-fields)
- [StateStore dialects](/architecture/gateway/statestore-dialects)

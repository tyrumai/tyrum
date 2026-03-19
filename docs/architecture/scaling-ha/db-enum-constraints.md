---
slug: /architecture/db-enum-constraints
---

# DB enum constraints

This is a compact reference card for columns that are intentionally constrained as enums at the database layer.

## Quick orientation

- **Read this if:** you are adding or changing `kind` / `status` columns in the StateStore.
- **Skip this if:** you only need the deployment or data-model overview.
- **Go deeper:** use [DB naming conventions](/architecture/db-naming-conventions) and the cited migrations.

## Constraint matrix

| Table / column     | Allowed values                             | Enforced in                                     |
| ------------------ | ------------------------------------------ | ----------------------------------------------- |
| `plans.kind`       | `audit`, `planner`                         | SQLite + Postgres `102_enum_constraints_v2.sql` |
| `plans.status`     | `active`, `success`, `escalate`, `failure` | SQLite + Postgres `102_enum_constraints_v2.sql` |
| `approvals.kind`   | `ApprovalKind` from `@tyrum/contracts`     | SQLite + Postgres `102_enum_constraints_v2.sql` |
| `approvals.status` | `ApprovalStatus` from `@tyrum/contracts`   | SQLite + Postgres `102_enum_constraints_v2.sql` |

## Rules

- Constrain enum-like columns in both dialects at the same migration boundary.
- Prefer shared schema enums where they already exist instead of inventing DB-only lists.
- If a `status` or `kind` column is intentionally open-ended, document that choice here.

## Intentionally unconstrained today

None recorded yet.

## Related docs

- [DB naming conventions](/architecture/db-naming-conventions)
- [Gateway data model map (v2)](/architecture/data-model-map)

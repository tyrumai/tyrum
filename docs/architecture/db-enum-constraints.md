# DB enum constraints

This document records which DB columns are treated as enums (and constrained at the database layer) vs intentionally open-ended.

## Constrained (CHECK)

### Plans (`plans`)

- `plans.kind`: `audit | planner`
- `plans.status`: `active | success | escalate | failure`

Enforced in:

- SQLite: `packages/gateway/migrations/sqlite/102_enum_constraints_v2.sql`
- Postgres: `packages/gateway/migrations/postgres/102_enum_constraints_v2.sql`

### Approvals (`approvals`)

- `approvals.kind`: `@tyrum/schemas` `ApprovalKind`
- `approvals.status`: `@tyrum/schemas` `ApprovalStatus`

Enforced in:

- SQLite: `packages/gateway/migrations/sqlite/102_enum_constraints_v2.sql`
- Postgres: `packages/gateway/migrations/postgres/102_enum_constraints_v2.sql`

## Intentionally unconstrained

None documented yet (add rows here when we intentionally keep a `status`/`kind` column open-ended).

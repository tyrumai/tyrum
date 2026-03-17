---
slug: /architecture/data-model-fk-audit
---

# Gateway FK audit

This is a reference decision record for the foreign-key audit called out in issue `#974`.

## Quick orientation

- **Read this if:** you are changing the schema, retention jobs, or delete semantics around approvals, runs, and policy overrides.
- **Skip this if:** you only need the high-level data model.
- **Go deeper:** use [Gateway data model map (v2)](/architecture/data-model-map) for the broader schema picture.

## Enforcement model

| Class              | Meaning                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Enforced FK**    | The reference participates in live integrity and should stay valid while the parent exists.                  |
| **Soft reference** | Keep the raw id for audit or future linking; detect drift with joins or audits instead of a hard constraint. |

## Current matrix

| Reference column                            | Decision       | Delete / repair rule                                                                                       | Why                                                                            |
| ------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `channel_outbox.approval_id`                | Enforced FK    | Null legacy orphans in migration; clear the child reference before parent delete.                          | Live queue-gating pointer.                                                     |
| `policy_overrides.created_from_approval_id` | Enforced FK    | Null legacy orphans in migration; clear the child reference before parent delete.                          | Provenance link that still needs explicit cleanup.                             |
| `approvals.run_id`                          | Enforced FK    | Null legacy orphans in migration; clear the child reference before parent delete.                          | Pause/resume and audit traces depend on this being valid while the run exists. |
| `approvals.step_id`                         | Enforced FK    | Null legacy orphans in migration; clear the child reference before parent delete.                          | Step-level traceability is part of live execution history.                     |
| `approvals.attempt_id`                      | Enforced FK    | Null legacy orphans in migration; clear the child reference before parent delete.                          | Retry and executor traces use the link as a live pointer.                      |
| `policy_overrides.agent_id`                 | Soft reference | Revoke or delete overrides during agent/workspace decommissioning until the ownership contract is settled. | The correct parent contract is still unresolved.                               |
| `policy_overrides.workspace_id`             | Soft reference | Revoke or delete overrides during agent/workspace decommissioning until the ownership contract is settled. | Optional workspace scoping is not stable enough for SQL enforcement yet.       |
| `approvals.work_item_id`                    | Soft reference | Preserve the raw id as an audit breadcrumb; use join audits before future enforcement.                     | Audit linkage, not a current live ownership edge.                              |
| `approvals.work_item_task_id`               | Soft reference | Preserve the raw id as an audit breadcrumb; use join audits before future enforcement.                     | Same as `work_item_id`.                                                        |

## Important delete rule

SQLite and Postgres both use tenant-scoped composite keys for the enforced subset. In practice that means parent deletion must clear the child reference explicitly first; these databases cannot null only the trailing id column while preserving the same FK shape automatically.

## Migration source of truth

The enforced subset is implemented in:

- `packages/gateway/migrations/sqlite/111_fk_audit_policy_approval_refs.sql`
- `packages/gateway/migrations/postgres/111_fk_audit_policy_approval_refs.sql`

## Follow-up trigger

Revisit the soft-reference subset only when one of these becomes stable enough to encode in SQL:

- a single ownership contract for `policy_overrides.agent_id` / `workspace_id`
- retention rules that prove the work-item links should remain hard and live

## Related docs

- [Gateway data model map (v2)](/architecture/data-model-map)
- [Operational table maintenance](/architecture/operational-maintenance)
- [DB naming conventions](/architecture/db-naming-conventions)

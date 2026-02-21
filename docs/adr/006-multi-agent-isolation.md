# ADR-006: Multi-Agent Isolation

**Status**: Accepted
**Date**: 2026-02-20

## Context

The gateway currently operates with a single `TYRUM_HOME` workspace and a single
`AgentRuntime` instance. All state tables (facts, episodic_events,
capability_memories, sessions, execution runs, approvals, artifacts) are implicitly
scoped to this single agent. There is no `agent_id` column anywhere in the gateway
source (`grep` confirms zero matches in `packages/gateway/src/`).

The gap analysis (ARI-024) identifies this as high risk because multi-agent
hosting requires hard namespacing to prevent cross-agent data leakage across
memory, sessions, execution, approvals, and artifacts.

## Decision

Introduce `agent_id` as a scoping column across all stateful tables, with a
backward-compatible migration strategy.

**Schema change**: Add `agent_id TEXT NOT NULL DEFAULT 'default'` to the following
tables:
- `facts`, `episodic_events`, `capability_memories` (memory subsystem)
- `sessions` (session management)
- `execution_runs`, `execution_steps`, `execution_attempts` (execution engine)
- `approvals` (approval subsystem)
- `artifact_metadata` (artifact subsystem, from ADR-004)
- `presence_entries` (presence subsystem, when implemented)

The `DEFAULT 'default'` ensures existing rows are assigned to the default agent
without data migration.

**DAL enforcement**: All Data Access Layer queries are scoped by `agent_id`. Every
SELECT, UPDATE, and DELETE includes `WHERE agent_id = ?` as a mandatory filter.
This is enforced by convention and reviewed in code review; a lint rule flags DAL
queries missing the `agent_id` predicate where the target table has the column.

**Single-agent mode**: When `TYRUM_MULTI_AGENT` is off (the default), all
operations use `agent_id = 'default'`. The feature flag controls whether the
gateway accepts agent routing (multiple agent_ids) or operates in legacy
single-agent mode.

**Agent routing**: When multi-agent is enabled, inbound requests (HTTP and WS)
include an `agent_id` in the path or message envelope. The gateway resolves the
target agent, loads its configuration and PolicyBundle, and scopes all subsequent
state operations to that agent_id.

## Consequences

### Positive
- Enables multi-tenant agent hosting on a single gateway instance.
- Hard namespacing prevents cross-agent data access by construction.
- `DEFAULT 'default'` makes migration seamless for existing single-agent deployments.
- Feature flag allows incremental adoption without affecting current users.

### Negative
- Widest blast radius of any change: every DAL module must be updated.
- Every new table and query going forward must include `agent_id` scoping.
- Compound indexes may need updating to include `agent_id` for query performance.

### Risks
- A missed `agent_id` filter in a DAL query could leak data between agents. This
  is the most critical risk. Mitigated by: lint rule for DAL queries, integration
  tests asserting cross-agent isolation, code review checklist item.
- Performance impact from adding a column to every query. Mitigated by: compound
  indexes including `agent_id` as leading column; `DEFAULT 'default'` keeps
  single-agent queries efficient.
- Schema migration on large tables could cause downtime. Mitigated by: `DEFAULT`
  value avoids backfill; additive column addition is non-blocking on both SQLite
  and Postgres.

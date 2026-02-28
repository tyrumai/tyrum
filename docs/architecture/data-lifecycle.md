# Data lifecycle and retention

## Status

- **Status:** Implemented

Tyrum is durable by design: the StateStore is the source of truth for sessions, execution, approvals, and audit evidence.
That durability must be paired with explicit **retention** and **deletion** rules so deployments remain operable (bounded cost), safe (privacy), and explainable (audit).

This page summarizes lifecycle expectations across the major data surfaces. It is intentionally implementation-agnostic; concrete defaults and knobs belong in deployment configuration and runbooks.

References:

- [Scaling and high availability](./scaling-ha.md)
- [Backplane (outbox contract)](./backplane.md)
- [Observability](./observability.md)
- [Artifacts](./artifacts.md)
- [Sandbox and policy](./sandbox-policy.md)

## Principles

- **Bounded by default:** every high-volume surface has an explicit retention/TTL/limit/budget.
- **Durable truth vs derived views:** durable tables are the source of truth; derived views (presence, directories, caches) are TTL-bounded.
- **Safety first:** sensitive classes (secrets, sensitive artifacts, connector payloads) default to shorter retention and stricter access.
- **Auditable deletion:** destructive lifecycle actions are observable and attributable (who/when/why).

## Data classes (what exists where)

### Durable StateStore data (system of record)

Examples:

- sessions and transcripts
- durable agent memory (facts, notes/preferences, procedures, tombstones)
- durable work state (WorkItems, task graphs, WorkArtifacts/DecisionRecords/WorkSignals, state KV)
- run/job/step/attempt state
- approvals and policy overrides
- audit/event logs and policy decision records
- outbox items (backplane)

Lifecycle expectations:

- Retention is configurable and documented.
- Stable identifiers remain stable across export/import (see [Scaling and high availability](./scaling-ha.md)).
- Deletions do not silently break referential “why was this allowed?” questions (for example keep minimal tombstones or export snapshots for audit as required by policy).

### Derived/TTL-bounded StateStore data

Examples:

- presence and instance inventory (TTL-pruned)
- connection directory entries (owning-edge heartbeats with TTL)
- inbound dedupe keys (TTL-bounded)

Lifecycle expectations:

- TTL pruning is safe under clustered edges (no correctness dependence on long-lived cache rows).
- TTL windows are chosen to tolerate normal jitter and brief partitions without creating “ghost ownership”.

Implementation note (gateway defaults):

- The gateway periodically prunes TTL-derived tables (`presence_entries`, `connection_directory`, `channel_inbound_dedupe`) based on their `expires_at_ms` columns.
- The gateway also prunes expired sessions/transcripts by deleting `sessions` rows whose `updated_at` is older than `TYRUM_SESSIONS_TTL_DAYS` (default: 30 days), including dependent rows in `session_provider_pins` and `context_reports`.
- Pruning runs on the `all` and `scheduler` gateway roles, with tick interval configurable via `TYRUM_STATESTORE_RETENTION_TICK_MS` (default: 5 minutes) and batch size configurable via `TYRUM_STATESTORE_RETENTION_BATCH_SIZE` (default: 10,000). In Postgres deployments, an advisory lock ensures only one instance runs per tick.

### Artifact bytes (FS/S3)

Artifact bytes live outside the StateStore; the StateStore holds metadata and durable linkage.

Lifecycle expectations:

- Artifact retention varies by label/sensitivity and is governed by policy (see [Artifacts](./artifacts.md)).
- Artifact fetch is always authorized by durable linkage (anti-IDOR) and is auditable.
- Deleting artifact bytes without deleting metadata should be treated as a first-class state (for example “missing bytes”) and surfaced to operators.

## Outbox/backplane retention (special case)

The outbox is both a delivery queue and a replay log. It must be durable **and** bounded.

Lifecycle expectations:

- Retention and compaction are explicit and enforced (see [Backplane](./backplane.md)).
- Operational recovery (edge restarts, brief partitions) should succeed without manual outbox surgery.
- When outbox items are deleted by retention, recovery remains possible via durable StateStore-backed reads (events are not the only truth).

## Memory budgets (special case)

Agent memory is durable by design, but must remain bounded for cost and operability. The default lifecycle model is **budget-based**, not time-based:

- Inactivity must not cause forgetting.
- When budgets are exceeded, the system performs consolidation and eviction until back under budget.
- Eviction should prefer compressing/re-summarizing high-volume episodic data and dropping derived indexes (embeddings) before deleting canonical memory content.
- Explicit “forget” actions must be auditable and should produce tombstones that preserve stable ids and deletion proof without retaining content.

## WorkBoard budgets (special case)

The WorkBoard is durable by design (work state must survive restarts and multi-channel use), but its drilldown surfaces must remain bounded for cost and operator usability.

Lifecycle expectations:

- WorkItems and task state are retained long enough to support audit and "why did it do that?" investigation.
- WorkArtifacts and DecisionRecords are retained under explicit budgets and may be summarized/consolidated at task boundaries or under pressure.
- WorkSignals are lifecycle-managed: fired/resolved signals are archived, compacted, or deleted according to policy so they do not accumulate indefinitely.
- Canonical state KV (agent/work item) is small and authoritative; updates and deletions are observable and attributable.

Budget knobs may include:

- max WorkArtifacts per WorkItem (and max body bytes per artifact),
- max DecisionRecords per WorkItem,
- max active WorkSignals per WorkItem/workspace (and history retention for fired signals),
- max KV entries per scope (agent/work item).

WorkBoard drilldown should prefer **linking** to durable run/step/approval/artifact identifiers over copying large raw logs, so auditability is preserved without unbounded growth.

## Redaction and privacy boundaries

Retention is only safe when redaction boundaries are correct:

- Secrets are referenced via handles and resolved only in trusted execution contexts (see [Secrets](./secrets.md)).
- Logs, tool outputs, artifacts, and outbound messages SHOULD apply redaction appropriate to the deployment’s policy.
- Treat WebSocket upgrade headers as sensitive (see [Handshake](./protocol/handshake.md)).

## Export/import and “forget” workflows

Snapshot export/import is part of the lifecycle story:

- Exports are consistent and preserve stable ids/hashes needed for audit and replay (see [Scaling and high availability](./scaling-ha.md)).
- Export bundles SHOULD document whether they include artifact bytes, and under what sensitivity rules.
  - Snapshot bundles declare this in `artifacts.bytes` (inclusion + sensitivity classes) and declare the presence of artifact-byte lifecycle fields via `artifacts.retention.execution_artifacts` (per-artifact lifecycle values live in `tables.execution_artifacts`).

If a deployment supports “forget” or data deletion requests, it MUST define:

- which durable records are deleted vs anonymized vs retained for audit,
- how linked artifacts are handled (metadata and bytes), and
- how the system proves deletion occurred (auditable events).

Implementation note (gateway audit streams):

- The gateway exposes `POST /audit/forget` to process explicit forget requests for audit streams stored in `planner_events`.
- Requests must include an explicit decision (`delete`, `anonymize`, or `retain`) and a confirmation string.
- The gateway records a `forget.proof` event with the decision and outcome; for destructive decisions it preserves hash-chain continuity via `prev_hash` linkage without retaining prior content.

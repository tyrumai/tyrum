# Gateway data model map (v2)

This page is a lightweight, human-readable map of the Gateway StateStore schema: table groups (“bounded contexts”), retention expectations, and sensitivity/PII notes for operators.

The v2 rebuild migrations are the current source of truth:

- SQLite: [`packages/gateway/migrations/sqlite/100_rebuild_v2.sql`](https://github.com/rhernaus/tyrum/blob/main/packages/gateway/migrations/sqlite/100_rebuild_v2.sql#L1)
- Postgres: [`packages/gateway/migrations/postgres/100_rebuild_v2.sql`](https://github.com/rhernaus/tyrum/blob/main/packages/gateway/migrations/postgres/100_rebuild_v2.sql#L1)

For the audited foreign-key vs soft-reference decisions on approval/policy linkage columns, see [Gateway FK audit](./data-model-fk-audit.md).

This document complements (and does not replace) the broader retention guidance in [Data lifecycle and retention](./data-lifecycle.md).

## Bounded contexts (table groups)

### Identity + scope

Tables:

- `tenants`, `agents`, `workspaces`, `agent_workspaces`

Purpose: durable identity and workspace scoping (multi-tenant boundary).

### Channels + sessions

Tables:

- `channel_accounts`, `channel_threads`
- `sessions`, `session_model_overrides`, `session_provider_pins`
- `session_send_policy_overrides`, `intake_mode_overrides`, `lane_queue_mode_overrides`, `lane_queue_signals`
- `channel_inbound_dedupe`, `channel_inbox`, `channel_outbox`

Purpose: connector accounts/threads, durable sessions/transcripts, and inbound/outbound queueing.

### Secrets + auth

Tables:

- `secrets`, `secret_versions`
- `auth_profiles`, `auth_profile_secrets`

Purpose: DB-backed secret handles + encrypted versions, and provider auth profile metadata.

### Policy + approvals

Tables:

- `policy_snapshots`, `policy_overrides`
- `approvals`
- `plans`, `planner_events`

Purpose: durable policy bundles/overrides plus approval and plan/audit surfaces.

### Execution engine

Tables:

- `execution_jobs`, `execution_runs`, `execution_steps`, `execution_attempts`
- `execution_artifacts`
- `resume_tokens`
- `lane_leases`, `workspace_leases`
- `idempotency_records`, `concurrency_slots`

Purpose: durable orchestration state (jobs/runs/steps/attempts), evidence metadata, and the leases/idempotency primitives that keep execution safe under retries.

### Automation (watchers)

Tables:

- `watchers`, `watcher_firings`

Purpose: durable watcher definitions and their firing/queue history.

### Canvas artifacts

Tables:

- `canvas_artifacts`, `canvas_artifact_links`

Purpose: operator/agent-authored artifacts that can be linked to plans, sessions, work items, or execution runs.

### Context reports

Tables:

- `context_reports`

Purpose: structured reports emitted by runtime components to support debugging/observability.

### Secret resolution audit

Tables:

- `secret_resolutions`

Purpose: audit trail of secret-handle resolutions (success/failure + minimal context).

### Presence + backplane

Tables:

- `principals`, `connections`
- `outbox`, `outbox_consumers`
- `presence_entries`

Purpose: node/client identity, live connections/capabilities, durable outbox delivery, and TTL presence inventory.

### Pairing + OAuth

Tables:

- `node_pairings`
- `oauth_pending`, `oauth_refresh_leases`
- `peer_identity_links`

Purpose: node pairing workflow and OAuth onboarding/book-keeping.

### Routing + model cache (operator/dev)

Tables:

- `routing_configs`
- `models_dev_cache`, `models_dev_refresh_leases`

Purpose: operator-managed routing configuration and a bounded “models list” dev cache/lease.

### WorkBoard

Tables:

- `work_items`, `work_item_tasks`, `subagents`
- `work_item_events`, `work_item_links`
- `work_artifacts`, `work_decisions`
- `work_signals`, `work_signal_firings`
- `work_item_state_kv`, `agent_state_kv`, `work_scope_activity`

Purpose: durable work tracking + drilldown surfaces for evidence, decisions, signals, and scoped state.

### Memory

Tables:

- `memory_items`, `memory_item_provenance`, `memory_item_tags`, `memory_tombstones`
- `memory_item_embeddings`, `vector_metadata`

Purpose: durable agent memory (canonical content) plus derived indexes (embeddings/vectors).

## Retention + sensitivity (PII map)

The table below is intentionally coarse-grained: it’s meant to help operators decide what needs strict retention/redaction controls and what can be safely pruned when a deployment is under storage pressure.

| Area (bounded context)  | Typical retention         | PII/sensitive content?    | Primary “hot” tables to watch                                      | Notes / pruning posture                                                           |
| ----------------------- | ------------------------- | ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Identity + scope        | Durable                   | Low                       | `tenants`, `agents`, `workspaces`                                  | Keep; small cardinality.                                                          |
| Channels + sessions     | Durable + bounded queues  | High (user content)       | `sessions`, `channel_inbox`, `channel_outbox`                      | Transcripts and connector payloads live here; queues must be bounded.             |
| Secrets + auth          | Durable                   | **Secrets**               | `secret_versions`, `auth_profile_secrets`                          | Treat as highly sensitive even if encrypted-at-rest.                              |
| Policy + approvals      | Durable                   | Medium–High               | `approvals`, `policy_snapshots`, `policy_overrides`                | Approvals/prompts can contain user content; policy bundles are security-critical. |
| Execution engine        | Durable + bounded logs    | Medium–High               | `execution_attempts`, `execution_artifacts`, `idempotency_records` | Outputs/errors may contain user data; prune/compact under explicit policy.        |
| Automation (watchers)   | Durable + bounded history | Low–Medium                | `watcher_firings`                                                  | History can grow; safe to prune old firings.                                      |
| Canvas artifacts        | Durable (budgeted)        | Medium–High               | `canvas_artifacts`                                                 | Human-authored content; bound by budgets/retention.                               |
| Context reports         | Bounded                   | Medium–High               | `context_reports`                                                  | Debug payloads can contain user content; keep short retention by default.         |
| Secret resolution audit | Bounded                   | Medium                    | `secret_resolutions`                                               | Keep for audit/security; prune with policy if needed.                             |
| Presence + backplane    | TTL + bounded replay      | Medium                    | `presence_entries`, `connections`, `outbox`                        | Presence/connections are TTL; outbox is durable but must be compacted.            |
| Pairing + OAuth         | TTL + bounded             | High (tokens/identifiers) | `oauth_pending`, `node_pairings`                                   | OAuth pending rows are short-lived; pairing contains device metadata.             |
| Routing + model cache   | Durable + TTL leases      | Low–Medium                | `routing_configs`, `models_dev_cache`                              | Config may contain endpoints/keys-by-handle; treat as sensitive metadata.         |
| WorkBoard               | Durable (budgeted)        | Medium–High               | `work_artifacts`, `work_decisions`, `work_item_events`             | Evidence/decisions can include user content; history can grow without budgets.    |
| Memory                  | Durable + derived indexes | High (user content)       | `memory_items`, `memory_item_embeddings`                           | Canonical memory is durable; embeddings/vectors are derived and can be rebuilt.   |

## Pruning checklist

When storage pressure increases, prune in this order (least risky → most sensitive). Always align with your deployment’s retention policy and audit requirements.

1. **TTL / derived surfaces (safe first)**
   - `presence_entries`, `connections` (remove expired rows)
   - `channel_inbound_dedupe` (remove expired rows)
   - `oauth_pending` (remove expired rows)
   - `lane_leases`, `workspace_leases`, `models_dev_refresh_leases`, `oauth_refresh_leases` (remove expired/abandoned leases)
   - `memory_item_embeddings`, `vector_metadata` (derived; safe to rebuild)

2. **Queue history + high-volume operational logs**
   - `channel_inbox`, `channel_outbox` (retain only what’s needed for delivery/audit; prune completed/sent/failed beyond your window)
   - `watcher_firings` (prune old, terminal firings)
   - `context_reports` (short retention; prune aggressively)
   - `idempotency_records`, `concurrency_slots` (bounded retention; prune old terminal rows)

3. **Durable “why did it do that?” surfaces (prune only with policy)**
   - `execution_attempts` / `execution_artifacts` metadata (coordinate with artifact-byte retention)
   - WorkBoard history tables: `work_item_events`, `work_signal_firings`, and oversized `work_artifacts` / `work_decisions` bodies

4. **Canonical truth (avoid ad-hoc deletion)**
   - `sessions` and `memory_items` are often the durable system-of-record for transcripts and memory. Only prune via explicit operator policy (and consider tombstones/export requirements).
   - `approvals` / `policy_*` / `routing_configs` are security/audit sensitive; delete only with explicit policy and change-control.

## Migration notes (SQLite vs Postgres)

- **Canonical reference:** treat `100_rebuild_v2.sql` as the authoritative table/column inventory; follow-up migrations add constraints/indexes.
- **SQLite:** altering tables is constrained; prefer additive migrations and avoid editing already-applied migrations. When a rebuild is unavoidable, prefer explicit copy + rebuild patterns and document the operational impact (downtime, backup/restore).
- **Postgres:** uses typed columns (`UUID`, `TIMESTAMPTZ`, `JSONB`, …) and `CASCADE` drops for rebuilds. Keep JSON fields as `JSONB` for queryability and consider GIN indexes where warranted by measured query patterns.

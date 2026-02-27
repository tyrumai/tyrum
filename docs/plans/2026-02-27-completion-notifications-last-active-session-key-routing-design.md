# Completion Notifications: last_active_session_key routing (Issue #603)

## Execution brief

- **Goal (SMART):** Persist `last_active_session_key` per `(tenant_id, agent_id, workspace_id)` and, when a WorkItem transitions to `done|blocked|failed`, emit the corresponding WorkBoard WS event and enqueue an outbound completion notification routed to the last active session key (fallback `created_from_session_key`), with idempotent delivery.
- **Non-goals:** Full presence-based routing, multi-connector rollout beyond existing channel plumbing, new UI surfaces; changing auth defaults or existing policy semantics.
- **Constraints:** Node 24 / pnpm workspace; strict TypeScript + ESM `.js` import specifiers; channel sends must remain policy/approval gated and deduped.
- **Plan:** (1) Add unit tests for routing + idempotency. (2) Implement a small WorkBoard notifier that resolves the route from durable state and enqueues a single channel outbox message with a stable dedupe key, honoring policy + approvals. (3) Update Telegram inbound to upsert `work_scope_activity`. (4) Add `work.item.failed` WS event and emit it on failed transitions. (5) Run `pnpm test && pnpm typecheck && pnpm lint`.
- **Risks & rollback:** Risk of misrouting when no durable channel route exists; mitigate by only sending when a recent `channel_inbox` row exists for the resolved session key. Roll back by reverting the notifier + schema changes.

## Design

### Durable last-active routing

- Source of truth for last-active is the WorkBoard persistence table `work_scope_activity`:
  - Primary key: `(tenant_id, agent_id, workspace_id)`
  - Values: `last_active_session_key`, `updated_at_ms`
- Update rule:
  - On inbound interactive channel activity (Telegram): upsert `work_scope_activity` for the agent/workspace with the inbound session key used for that message.

### Completion notification routing

When a WorkItem transitions to `done|blocked|failed`:

1. Resolve `target_session_key`:
   - Prefer `work_scope_activity.last_active_session_key`
   - Fallback to `work_items.created_from_session_key`
2. Resolve a concrete channel destination (best-effort, durable):
   - Look up the newest `channel_inbox` row for `key = target_session_key`
   - If none exists, do not enqueue a channel send (Desktop WS clients still receive WorkBoard WS events).
3. Enqueue one outbound message into `channel_outbox`:
   - `inbox_id`: from the resolved `channel_inbox` row (for policy overrides + FK integrity)
   - `source` / `thread_id`: from the resolved `channel_inbox` row
   - `dedupe_key`: stable per transition (e.g. `work.notify:<work_item_id>:<status>:<updated_at>`)
   - `chunk_index`: `0`
   - `parse_mode`: unset (plain text)
4. Policy + approvals:
   - Evaluate `PolicyService.evaluateConnectorAction` for the resolved connector/thread.
   - If `require_approval`, create an approval and set `approval_id` on the outbox row.
   - If `deny` (and policy is enforcing), skip enqueue.

### WorkBoard WS events

- Continue emitting existing WorkBoard WS events for `blocked` and `done`.
- Add explicit `work.item.failed` WS event and emit it when a WorkItem transitions to `failed`.

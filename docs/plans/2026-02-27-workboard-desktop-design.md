# Desktop WorkBoard (Kanban + Drilldown) — Design

## Execution brief (KISS)
- **Goal:** Add a Desktop UI that shows WorkBoard Kanban columns and a WorkItem drilldown, backed by the WS `work.*` protocol, updating live via WS events.
- **Non-goals:** Full CRUD on WorkItems; full task-DAG visualization; cross-workspace selection UI; replacing Operator UI.
- **Constraints:** Electron renderer is browser-like (`nodeIntegration: false`); must use `@tyrum/client`; scope currently assumed `tenant_id/agent_id/workspace_id = "default"`.
- **Plan:** Add a new `WorkBoard` page + sidebar entry → add a small pure reducer/store for WS events → fetch drilldown data on selection → add unit tests + light wiring tests.
- **Risks & rollback:** WS workboard may be unsupported if DB not configured → show a clear error; rollback by removing the new page/nav entry (no DB/schema changes).

## Summary
Issue #608 requests a Desktop UI that renders:
- a WorkBoard Kanban summary (Backlog/Ready/Doing/Blocked/Done/Failed/Cancelled)
- a WorkItem drilldown view suitable for “progress checks” and “what changed and why?”

The data source is the WS-only WorkBoard protocol and event stream (`work.list`, `work.get`, `work.*.list` + `work.*` events).

## Approaches
### A) Desktop-native page using `@tyrum/client` (Recommended)
- Add a new Desktop sidebar page (`Work`) implemented in `apps/desktop/src/renderer/pages/WorkBoard.tsx`.
- Use `window.tyrumDesktop.gateway.getOperatorConnection()` to obtain `wsUrl` + `token`.
- Use `TyrumClient` to `work.list` on connect and subscribe to `work.*` events for live updates.
- Keep UI logic thin and push state updates into a small pure reducer module (easy to unit-test).

**Pros:** Minimal surface area; fast to ship; uses the canonical SDK; isolated to desktop.
**Cons:** Scope selection is hard-coded initially; TLS pinning for `wss://` is not enforced in renderer.

### B) Implement inside `@tyrum/operator-ui` and reuse in Desktop and Web
**Pros:** Shared UI across clients; avoids duplication.
**Cons:** Larger scope; requires operator-ui navigation/state plumbing; likely more work than issue asks.

### C) Main-process WS client + IPC bridge
**Pros:** Can enforce TLS pinning (Node-only) for remote `wss://` connections; renderer stays “dumb”.
**Cons:** Significantly more complexity and IPC surface; higher maintenance.

## Chosen design
Implement **Approach A**:
- A new Desktop sidebar page named **Work** that shows:
  - Kanban board (7 columns)
  - Drilldown panel for the selected WorkItem

## Data model and WS integration
### Scope
WorkBoard protocol is scoped by `{ tenant_id, agent_id, workspace_id }`.

Initial implementation uses:
```ts
{ tenant_id: "default", agent_id: "default", workspace_id: "default" }
```

### Initial load
On WS `connected`:
- call `work.list` for the scope (optionally with a default `limit`)
- render cards grouped by `WorkItem.status`

### Live updates
Subscribe to the WorkBoard event stream and apply events idempotently:
- `work.item.*` → upsert WorkItem by `work_item_id`
- `work.task.*` → update an in-memory task status map (for drilldown summaries)
- `work.artifact.created` / `work.decision.created` / `work.signal.*` → update drilldown lists when relevant
- `work.state_kv.updated` → refresh affected KV entries via `work.state_kv.get` (event does not include value)

### Drilldown data
When a WorkItem is selected, fetch:
- `work.get`
- `work.artifact.list` (filtered by `work_item_id`)
- `work.decision.list` (filtered by `work_item_id`)
- `work.signal.list` (filtered by `work_item_id`)
- `work.state_kv.list` for:
  - agent scope: `{ kind:"agent", tenant_id, agent_id, workspace_id }`
  - work_item scope: `{ kind:"work_item", tenant_id, agent_id, workspace_id, work_item_id }`

## UI layout
- **Top bar:** connection indicator + refresh button.
- **Kanban:** 7 columns, each showing count and item cards.
- **Cards:** title, kind, priority, timestamps (created/last active), plus status badge.
- **Drilldown panel:** sections:
  - Summary + acceptance (best-effort render; fallback to JSON)
  - State + timestamps
  - Task status summary (derived from WS task events)
  - Blockers (paused tasks with `approval_id`)
  - Latest DecisionRecords (question/chosen/rationale)
  - WorkArtifacts list (kind/title/created/ref ids)
  - WorkSignals list (trigger/status/last fired)
  - Canonical KV (agent + work item)

## Error handling
- If WS fails to connect: show transport error and retry status.
- If `work.list` returns `unsupported_request` (DB not configured): show a clear “WorkBoard not supported” message.
- If remote TLS pinning is configured: do not fail; show a warning that pinning is not enforced in renderer.

## Testing strategy
- Unit tests for the pure WorkBoard store/reducer:
  - grouping into columns
  - upserting items from `work.item.*` events
  - tracking task status from `work.task.*` events
  - updating artifact/decision/signal lists
- Lightweight wiring tests (string-based) to ensure:
  - Sidebar contains the Work page entry
  - App routes/render includes the Work page id


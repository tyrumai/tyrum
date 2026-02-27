# TUI Memory Inspector Design

**Issue:** #665

## Execution brief

- **Goal (SMART):** Add operator TUI screens to search/list/view/forget/export Memory v1 items, with explicit confirmation for forget, by end of this change set.
- **Non-goals:** Memory create/update UI; rich filtering UX; pagination UX beyond a simple “refresh”; rendering Markdown; downloading exported artifacts.
- **Constraints:** Node 24 + pnpm workspace; strict TS/ESM; Ink TUI input is keystroke-driven (no extra deps); avoid duplicating logic already in stores.
- **Plan:** Add an operator-core `memoryStore` backed by WS `memory.*`; add a TUI “Memory” route with list/search + selected details; add forget/export flows; add tests; verify `pnpm test/typecheck/lint/format:check`.
- **Risks & rollback:** New UI/commands may regress key handling; rollback is `git revert` of the feature commits or disabling the route/keybinding.

## Context

Memory v1 APIs exist over WebSocket (`memory.search/list/get/forget/export`). This change exposes an operator-facing inspection surface in the TUI so operators can debug, audit, and manage durable memory state.

## User experience

### Navigation

- Add a new top-level route: `6=memory`.
- The Memory screen is a single screen with:
  - A list area (search hits or list items).
  - A “Selected” details area below (similar to Approvals/Pairing).

### Search/list

- Default view: list recent items via `memory.list` (limit ~50).
- Search flow: open a small “Search” dialog, type query, press Enter → run `memory.search` (limit ~50).
- `r` refreshes the current mode (re-run list or re-run the last search).

### Detail view

When an item is selected, the screen shows:

- Common fields: `memory_item_id`, `kind`, `agent_id`, `tags`, `sensitivity`, timestamps, provenance summary.
- Kind-specific payload (fact key/value; note/procedure body_md; episode summary_md + occurred_at).

### Forget (explicit confirmation)

- Key `f` opens a confirmation dialog for the selected item.
- Operator must type `FORGET` and press Enter to proceed.
- On success, the UI refreshes the current list/search and shows a short status line with `deleted_count`.

### Export (artifact id)

- Key `p` exports all items currently addressable by the screen’s filter (initially: no filter → export all) using `memory.export`.
- UI displays the returned `artifact_id` for the operator to fetch via other tooling.

### Admin mode gating

- Forget/export are gated behind Admin Mode in the TUI (consistent with other privileged actions).
- Search/list/get are available without Admin Mode.
- Admin Mode device token minting must include `operator.write` to allow `memory.forget` and `memory.export` when using scoped tokens.

## Architecture

### Operator core

- Add `memoryStore` to `OperatorCore`.
- `memoryStore` is responsible for:
  - Holding the current “mode” (`list` vs `search`) and the last request parameters.
  - Caching returned items by id for detail rendering.
  - Running WS requests via the existing ws client helpers.

### TUI

- Extend the existing key reducer to include a `memory` route and cursor selection.
- Implement small Ink dialogs (search + forget confirmation) using the existing keystroke capture pattern used by the Admin Mode dialog.

## Error handling

- Memory store surfaces a single `error` string and `loading` booleans to the UI.
- UI displays errors inline in red and keeps the last successful results displayed.

## Testing

- Unit tests:
  - `tui-input` reducer: route switching and cursor behavior for the memory screen.
  - `TuiApp` integration: rendering the Memory route and triggering search/forget/export flows against stubbed stores.
- (Optional follow-up) E2E: harness-based test with a real gateway (not required for initial scope).

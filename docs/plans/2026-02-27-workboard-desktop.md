# Desktop WorkBoard (Kanban + Drilldown) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Desktop UI that renders the WorkBoard Kanban and a WorkItem drilldown view, backed by WS `work.*` requests and `work.*` events.

**Architecture:** Add a new Desktop renderer page that uses `@tyrum/client` to load and subscribe to WorkBoard state. Keep state transitions in a pure reducer module for unit testing and UI simplicity.

**Tech Stack:** Electron renderer (React), `@tyrum/client` (`TyrumClient`), `@tyrum/schemas`, Vitest.

---

### Task 1: Add a pure WorkBoard store + reducer

**Files:**

- Create: `apps/desktop/src/renderer/lib/workboard-store.ts`
- Test: `apps/desktop/tests/workboard-store.test.ts`

**Step 1: Write the failing tests**

- Define a minimal `WorkItem` fixture.
- Assert:
  - `upsertWorkItem()` inserts and updates by `work_item_id`.
  - `groupWorkItemsByStatus()` returns 7 columns and preserves sort order.
  - `applyWorkTaskEvent()` derives task state transitions from `work.task.*` events.

Run: `pnpm --filter tyrum-desktop test --filter workboard-store`
Expected: FAIL (module does not exist / functions not implemented).

**Step 2: Implement minimal store**

- Implement the functions needed to pass the tests (no UI yet).

**Step 3: Run tests**
Run: `pnpm --filter tyrum-desktop test --filter workboard-store`
Expected: PASS.

### Task 2: Wire WorkBoard page into Desktop navigation (TDD wiring tests)

**Files:**

- Create: `apps/desktop/src/renderer/pages/WorkBoard.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/components/Sidebar.tsx`
- Test: `apps/desktop/tests/workboard-nav.test.ts`

**Step 1: Write failing wiring tests**

- Read `App.tsx` and `Sidebar.tsx` and assert the WorkBoard page id is present.

Run: `pnpm --filter tyrum-desktop test --filter workboard-nav`
Expected: FAIL.

**Step 2: Implement page + nav**

- Add sidebar entry (label “Work”).
- Add page id `"work"` to router and render `<WorkBoard />`.
- Implement `WorkBoard` page skeleton (no WS yet) that renders headings + 7 empty columns.

**Step 3: Run tests**
Run: `pnpm --filter tyrum-desktop test --filter workboard-nav`
Expected: PASS.

### Task 3: Implement WS-backed Kanban + drilldown

**Files:**

- Modify: `apps/desktop/src/renderer/pages/WorkBoard.tsx`
- Modify: `apps/desktop/src/renderer/lib/workboard-store.ts`
- Test: extend `apps/desktop/tests/workboard-store.test.ts`

**Step 1: Write failing tests for event application**

- Add test cases for:
  - `work.item.updated` upserts item and moves columns (status change)
  - `work.artifact.created` updates artifact list for selected work item
  - `work.state_kv.updated` triggers KV refresh helper (unit-test helper logic)

Run: `pnpm --filter tyrum-desktop test --filter workboard-store`
Expected: FAIL.

**Step 2: Implement minimal logic + UI**

- On mount: fetch operator connection via Desktop IPC.
- Create `TyrumClient` and connect.
- On `connected`: call `work.list` with default scope.
- Subscribe to relevant `work.*` events and update store state.
- On item selection: fetch drilldown via `work.get` + list APIs and render sections.

**Step 3: Run tests**
Run: `pnpm --filter tyrum-desktop test --filter workboard-store`
Expected: PASS.

### Task 4: Verification and PR

**Commands:**

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`

**PR:**

- Title: `feat(desktop): WorkBoard kanban + drilldown view (#608)`
- Body: include `Closes #608` and paste verification command outputs.

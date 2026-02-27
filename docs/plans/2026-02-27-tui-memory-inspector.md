# TUI Memory Inspector Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement operator TUI screens for Memory v1 search/list/detail/forget/export (issue #665).

**Architecture:** Add an `operator-core` `memoryStore` backed by WS `memory.*` requests and expose it through `OperatorCore`. Extend the Ink TUI with a new `memory` route that renders list/search results and a selected item detail panel, plus dialogs for search and forget confirmation.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Ink, `@tyrum/client` WS helpers, `@tyrum/operator-core` stores.

---

### Task 1: Add memory route state and reducer support

**Files:**

- Modify: `packages/tui/src/tui-input.ts`
- Test: `packages/tui/tests/tui-input.test.ts`

**Step 1: Write the failing test**

- Add a test that `input === "6"` routes to `memory` and initializes memory cursor state.

**Step 2: Run test to verify it fails**

- Run: `pnpm test packages/tui/tests/tui-input.test.ts`
- Expected: FAIL (route not supported).

**Step 3: Write minimal implementation**

- Extend `TuiRouteId`, `TuiUiState`, and `reduceTuiInput` to support `memory`.

**Step 4: Run test to verify it passes**

- Run: `pnpm test packages/tui/tests/tui-input.test.ts`

---

### Task 2: Add operator-core memory store (WS-backed)

**Files:**

- Create: `packages/operator-core/src/stores/memory-store.ts`
- Modify: `packages/operator-core/src/operator-core.ts`
- Modify: `packages/operator-core/src/deps.ts`
- Modify: `packages/operator-core/src/index.ts`
- Test: `packages/operator-core/tests/operator-core.test.ts`

**Step 1: Write the failing test**

- Extend the operator-core test fake ws client to include `memory.list/get/search/forget/export` methods, then assert the core exposes `memoryStore`.

**Step 2: Run test to verify it fails**

- Run: `pnpm test packages/operator-core/tests/operator-core.test.ts`

**Step 3: Write minimal implementation**

- Add `memoryStore` and wire it into core creation.

**Step 4: Run test to verify it passes**

- Run: `pnpm test packages/operator-core/tests/operator-core.test.ts`

---

### Task 3: Implement Memory screen in TUI

**Files:**

- Modify: `packages/tui/src/app.tsx`
- Test: `packages/tui/tests/app.test.ts`

**Step 1: Write the failing test**

- Extend the TuiApp test core stub with a `memoryStore` and assert route renders and key presses call the right store methods.

**Step 2: Run test to verify it fails**

- Run: `pnpm test packages/tui/tests/app.test.ts`

**Step 3: Write minimal implementation**

- Add route `memory`, render list + selected detail, and dialogs for search and forget confirmation.

**Step 4: Run test to verify it passes**

- Run: `pnpm test packages/tui/tests/app.test.ts`

---

### Task 4: Ensure Admin Mode can perform memory write actions

**Files:**

- Modify: `packages/tui/src/core.ts`
- Test: `packages/tui/tests/admin-mode.test.ts`

**Step 1: Write the failing test (if needed)**

- If existing tests cover requested scopes, extend; otherwise add a focused assertion that elevated token minting includes `operator.write` for memory operations.

**Step 2: Implement**

- Add `operator.write` to the minted scopes list.

**Step 3: Verify**

- Run: `pnpm test packages/tui/tests/admin-mode.test.ts`

---

### Task 5: Full verification + PR

**Step 1: Verify formatting**

- Run: `pnpm format:check` (run `pnpm format` if needed)

**Step 2: Verify quality gates**

- Run: `pnpm test && pnpm typecheck && pnpm lint`

**Step 3: Open PR**

- `gh pr create` with body including `Closes #665` and test evidence.

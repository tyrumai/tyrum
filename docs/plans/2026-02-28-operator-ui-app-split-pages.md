# Operator UI `app.tsx` Page Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split `packages/operator-ui/src/app.tsx` into page components under `packages/operator-ui/src/components/pages/` and keep `app.tsx` ≤200 lines with routing/layout only.

**Architecture:** `OperatorUiApp` stays responsible for route state, shell layout, and wiring props. Each page is a standalone React component module under `components/pages/` (including `DesktopPage` and `MemoryPage`).

**Tech Stack:** React 19 + TypeScript (strict, ESM), Vitest.

---

### Task 1: Add a failing structural regression test

**Files:**

- Create: `packages/operator-ui/tests/app-page-components.test.ts`

**Step 1: Write the failing test**

- Assert `packages/operator-ui/src/app.tsx` line count is ≤200.
- `import()` each page module from `packages/operator-ui/src/components/pages/*.js` and assert it exports the expected component.

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/operator-ui/tests/app-page-components.test.ts`  
Expected: FAIL (app.tsx too large and/or modules not found).

### Task 2: Move existing pages into `components/pages/`

**Files:**

- Move: `packages/operator-ui/src/pages/*.tsx` → `packages/operator-ui/src/components/pages/*.tsx`
- Modify (imports): moved page files

**Step 1: Move files**

Run: `git mv packages/operator-ui/src/pages packages/operator-ui/src/components/pages`

**Step 2: Fix relative imports inside moved files**

- Update `../components/...` → `../ui/...` / `../layout/...` as needed (paths shift by one segment).
- Keep exported component names unchanged.

### Task 3: Extract `DesktopPage` and add `MemoryPage`

**Files:**

- Create: `packages/operator-ui/src/components/pages/desktop-page.tsx`
- Create: `packages/operator-ui/src/components/pages/memory-page.tsx`
- Modify: `packages/operator-ui/src/app.tsx`

**Step 1: Move `DesktopSetupPage` implementation**

- Copy the existing `DesktopSetupPage` body from `app.tsx` into `DesktopPage` in the new file.
- Keep behavior identical (same state, effects, handlers, and UI).

**Step 2: Add `MemoryPage` wrapper**

- Render `<MemoryInspector core={core} />` inside a page-level container.

### Task 4: Wire new pages from `app.tsx` and update tests

**Files:**

- Modify: `packages/operator-ui/src/app.tsx`
- Modify: `packages/operator-ui/tests/**/*.ts`

**Step 1: Update `app.tsx` imports**

- Import pages from `./components/pages/*.js`.
- Render `<DesktopPage ... />` and `<MemoryPage ... />` for their routes.

**Step 2: Update test imports/mocks**

- Replace `../src/pages/*` imports with `../src/components/pages/*`.
- Update any `vi.mock()` specifiers to match the new module paths.

### Task 5: Verify + commit

**Step 1: Run verification**

Run:

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check` (run `pnpm format` if needed, then re-run `pnpm format:check`)

**Step 2: Commit**

Commit message: `refactor(operator-ui): split app.tsx into page components (#838)`

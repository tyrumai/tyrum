# Operator UI `app.tsx` Page Split Design

**Issue:** #838

## Execution brief

- **Goal (SMART):** Move Operator UI page components into `packages/operator-ui/src/components/pages/`, extract `Desktop` and `Memory` into page components, and reduce `packages/operator-ui/src/app.tsx` to ≤200 lines (routing + layout only) in this PR, with no behavior change.
- **Non-goals:** UI redesign; new routing library; adding new pages.
- **Constraints:** Node 24 + pnpm workspace; strict TS/ESM with `.js` import specifiers; preserve current UI behavior; keep diffs small and avoid duplication.
- **Plan:** Add a structural regression test (pages importable from new paths + `app.tsx` line-count budget) → move existing `src/pages/*.tsx` via `git mv` → extract `DesktopPage` + `MemoryPage` → update `app.tsx` and tests to use new imports → verify `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`.
- **Risks & rollback:** Risk: missing/incorrect relative imports after moves; rollback via `git revert` of the refactor commits. Structural test + existing page tests reduce regression risk.

## Context

`packages/operator-ui/src/app.tsx` currently contains routing/layout plus an inline Desktop setup page implementation, and imports other pages from `packages/operator-ui/src/pages/*`. This issue aims to:

- keep `OperatorUiApp` in `app.tsx` as the router/layout component,
- move page components under `components/pages/`,
- keep behavior unchanged while making `app.tsx` small and readable.

## Approaches

### Option A (recommended): Move + update imports (no shims)

- Create `packages/operator-ui/src/components/pages/`.
- `git mv` existing `packages/operator-ui/src/pages/*.tsx` into `components/pages/`.
- Extract the inline Desktop setup UI from `app.tsx` into `components/pages/desktop-page.tsx`.
- Add a small `components/pages/memory-page.tsx` wrapper around `MemoryInspector`.
- Update `app.tsx` + tests to import from `components/pages/*`.

**Pros:** simplest, no duplication, aligns with issue goals.  
**Cons:** any out-of-tree imports of `src/pages/*` would break (none expected; confirmed by ripgrep).

### Option B: Move + keep `src/pages/*` as re-export shims

Same as Option A, but keep the old `src/pages/*` modules as re-exports that forward to `components/pages/*`.

**Pros:** extra safety for internal consumers.  
**Cons:** extra files and indirection.

## Testing strategy

- Add a new regression test that:
  - asserts `packages/operator-ui/src/app.tsx` is ≤200 lines, and
  - verifies all expected page modules exist and can be imported from `src/components/pages/*`.
- Rely on existing operator-ui unit tests (Dashboard/Approvals/Runs/etc.) to detect any behavior regressions from the move.

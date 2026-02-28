# Policy: Desktop op-aware match targets for `tool.node.dispatch` — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close #773 by making `tool.node.dispatch` Desktop match targets reliably include `op` and by providing conservative suggested override patterns for Desktop `act`.

**Architecture:** Extend match target canonicalization to handle nested Desktop args wrappers; centralize suggested override generation so Desktop `act` can suggest a safe `op:act*` prefix pattern.

**Tech Stack:** TypeScript (ESM), Vitest, gateway policy/agent runtime modules.

---

### Task 1: Add failing regression tests (RED)

**Files:**

- Modify (test): `packages/gateway/tests/unit/policy-match-target.test.ts`
- Modify (test): `packages/gateway/tests/unit/agent-runtime.test.ts`

**Step 1: Add a failing test for nested Desktop args wrappers**

- Add a `canonicalizeToolMatchTarget("tool.node.dispatch", ...)` test where Desktop args are wrapped under an inner `args` object and assert `op` still normalizes (for example `op:snapshot`).

**Step 2: Add a failing test for Desktop `act` suggested overrides**

- Add an AgentRuntime unit test that triggers an approval for `tool.node.dispatch` Desktop `act` and asserts suggested overrides include `capability:tyrum.desktop;action:Desktop;op:act*`.

**Step 3: Run gateway unit tests to confirm failures**

- Run: `pnpm --filter @tyrum/gateway test`
- Expected: the new tests fail prior to implementation changes.

### Task 2: Implement minimal fixes (GREEN)

**Files:**

- Modify (code): `packages/gateway/src/modules/policy/match-target.ts`
- Modify (code): `packages/gateway/src/modules/agent/runtime/agent-runtime.ts`
- Create (code): `packages/gateway/src/modules/policy/suggested-overrides.ts`

**Step 1: Fix nested Desktop `op` extraction**

- Update Desktop op canonicalization to fall back to a nested wrapper object (for example `args.args.op`) when top-level `op` is missing.
- Ensure match targets do not include selector text or other high-entropy values.

**Step 2: Centralize and improve suggested override generation**

- Introduce a small helper that always suggests the exact match target (when safe), and additionally suggests `capability:tyrum.desktop;action:Desktop;op:act*` for Desktop `act` match targets.

**Step 3: Run gateway tests to confirm green**

- Run: `pnpm --filter @tyrum/gateway test`
- Expected: new and existing tests pass.

### Task 3: Document match targets and verify (REFINE + VERIFY)

**Files:**

- Modify (docs): `docs/architecture/tools.md`
- Modify (docs): `docs/architecture/policy-overrides.md`

**Step 1: Update docs with `tool.node.dispatch` Desktop match target examples**

- Add examples for Desktop ops and recommended safe override patterns (no leading wildcards).

**Step 2: Full verification gate**

- Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
- If format check fails: run `pnpm format` then re-run `pnpm format:check`.

# Admin hub (HTTP): Routing config + Secrets panels Implementation Plan

> **For agent execution:** follow strict TDD (RED → GREEN → REFACTOR) for new UI behavior and tests.

**Goal:** Add Operator UI Admin HTTP panels for routing config + secrets endpoints with Admin Mode gating and explicit mutation confirmation, without leaking secret values.

**Architecture:** Extend `packages/operator-ui` `AdminPage` HTTP tab to render two section components (Routing config + Secrets). Each action stores its latest result/error and renders via `ApiResultCard`. Mutations are wrapped in `ConfirmDangerDialog`.

**Tech Stack:** React, `@tyrum/operator-ui` UI primitives, Vitest (jsdom).

---

### Task 1: Add failing tests for Admin HTTP panels (RED)

**Files:**

- Create: `packages/operator-ui/tests/pages/admin-page.http.test.ts`

**Step 1: Write failing tests**

- Render `AdminPage` with Admin Mode active and assert the new panels appear.
- Click a mutation action (e.g. “Update routing config”) and assert:
  - a confirmation dialog opens
  - confirm button is disabled until checkbox is checked
  - API method is only called after confirming

**Step 2: Run tests to verify they fail**

Run: `pnpm test packages/operator-ui/tests/pages/admin-page.http.test.ts`

Expected: FAIL because panels/testids don’t exist yet.

### Task 2: Implement Routing config HTTP panel (GREEN)

**Files:**

- Modify: `packages/operator-ui/src/components/pages/admin-page.tsx`
- Create: `packages/operator-ui/src/components/pages/admin-http-routing-config.tsx`

**Step 1: Minimal implementation**

- Add a `RoutingConfigPanel` component:
  - `Get` button calls `core.http.routingConfig.get()`
  - `Update` uses `JsonTextarea` for config + `ConfirmDangerDialog`
  - `Revert` uses a number input + `ConfirmDangerDialog`
- Render it under the Admin HTTP tab.

**Step 2: Run tests**

Run: `pnpm test packages/operator-ui/tests/pages/admin-page.http.test.ts`

Expected: tests still fail until Secrets panel is added / testids match.

### Task 3: Implement Secrets HTTP panel (GREEN)

**Files:**

- Modify: `packages/operator-ui/src/components/pages/admin-page.tsx`
- Create: `packages/operator-ui/src/components/pages/admin-http-secrets.tsx`

**Step 1: Minimal implementation**

- Add a `SecretsPanel` component:
  - `List` calls `core.http.secrets.list({ agent_id })`
  - `Store`, `Rotate`, `Revoke` are wrapped in `ConfirmDangerDialog`
  - Secret `value` inputs use password fields and are cleared on success
- Render it under the Admin HTTP tab.

**Step 2: Run tests**

Run: `pnpm test packages/operator-ui/tests/pages/admin-page.http.test.ts`

Expected: PASS.

### Task 4: Refactor (REFACTOR)

**Files:**

- Modify: `packages/operator-ui/src/components/pages/admin-http-routing-config.tsx`
- Modify: `packages/operator-ui/src/components/pages/admin-http-secrets.tsx`

**Steps:**

- Extract shared helpers (e.g. query normalization for `agent_id`) if used ≥2 times.
- Ensure no secret values are rendered in confirmation UI or results.
- Ensure `data-testid` coverage for tests is stable and minimal.

### Task 5: Full verification + formatting

Run:

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check` (run `pnpm format` if it fails)

### Task 6: Commit + PR

Before each commit:

- Run `pnpm format:check` (and `pnpm format` if needed)

Open PR:

- Title: `Admin hub (HTTP): Routing config + Secrets panels (#915)`
- Body includes: `Closes #915` and test evidence.

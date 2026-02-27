# Desktop Admin Mode Wiring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire Admin Mode into the desktop renderer so selected auth (baseline vs elevated) switches the `OperatorCore` (WS reconnect + HTTP auth), while keeping admin-only actions gated by existing operator-ui Admin Mode components.

**Architecture:** Add a small desktop OperatorCore manager (modeled after `apps/web/src/operator-core-manager.ts`) that recreates `OperatorCore` when `AdminModeStore` changes the selected auth. Update the desktop `Gateway.tsx` renderer to use the manager and a shared `AdminModeStore`.

**Tech Stack:** TypeScript, React, Vitest, `@tyrum/operator-core`, `@tyrum/operator-ui`, `@tyrum/client`.

---

### Task 1: Write failing unit tests for the desktop OperatorCore manager

**Files:**
- Create: `apps/desktop/tests/renderer-operator-core-manager.test.ts`
- Create: `apps/desktop/src/renderer/lib/operator-core-manager.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { createAdminModeStore, createBearerTokenAuth } from "@tyrum/operator-core";
import { createDesktopOperatorCoreManager } from "../src/renderer/lib/operator-core-manager.js";

it("recreates core + reconnects when Admin Mode enters", () => {
  // ...red test: should fail until manager exists/works
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- apps/desktop/tests/renderer-operator-core-manager.test.ts`  
Expected: FAIL (module/function missing).

**Step 3: Commit**

Run:
```bash
git add apps/desktop/tests/renderer-operator-core-manager.test.ts
git commit -m "test(desktop): cover admin mode core switching manager"
```

### Task 2: Implement the desktop OperatorCore manager (minimal API)

**Files:**
- Create: `apps/desktop/src/renderer/lib/operator-core-manager.ts`

**Step 1: Minimal implementation to satisfy tests**

- Implement `createDesktopOperatorCoreManager({ wsUrl, httpBaseUrl, baselineAuth, adminModeStore, createCore })`.
- Use `selectAuthForAdminMode` and an `isSameAuth` helper to avoid recreating cores on admin tick updates.
- Reconnect new core if previous core status was `connecting` or `connected`.

**Step 2: Run the unit test**

Run: `pnpm test -- apps/desktop/tests/renderer-operator-core-manager.test.ts`  
Expected: PASS.

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/lib/operator-core-manager.ts
git commit -m "feat(desktop): manage operator core auth switching"
```

### Task 3: Wire the manager into the desktop renderer Gateway page

**Files:**
- Modify: `apps/desktop/src/renderer/pages/Gateway.tsx`

**Step 1: Update `Gateway.tsx` to use a shared `AdminModeStore` + manager**

- Build a desktop IPC fetch adapter (existing code).
- Create `adminModeStore` once per boot session.
- Create the manager with a `createCore` factory that:
  - Creates an IPC-backed `createTyrumHttpClient({ baseUrl, auth: httpAuthForAuth(auth), fetch: ipcFetch })`
  - Calls `createOperatorCore({ wsUrl, httpBaseUrl, auth, adminModeStore, deps: { http } })`
- Subscribe to the manager to update React state when the core is swapped.
- Call `core.connect()` once at startup and allow the manager to reconnect on auth switches.
- Ensure cleanup disposes: subscription, manager, and `adminModeStore`.

**Step 2: Run affected tests**

Run: `pnpm test -- apps/desktop/tests/renderer-operator-core-manager.test.ts`  
Expected: PASS.

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/pages/Gateway.tsx
git commit -m "feat(desktop): wire admin mode auth switching into renderer"
```

### Task 4: Full verification

**Step 1: Run unit tests**

Run: `pnpm test`  
Expected: PASS.

**Step 2: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`  
Expected: PASS.

**Step 3: Run formatting**

Run: `pnpm format`  
Expected: PASS / clean diff.


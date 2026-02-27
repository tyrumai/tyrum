# Desktop Admin Mode Wiring (Desktop App) — Design

## Execution Brief

- **Goal (SMART):** Update the desktop renderer so entering/exiting Admin Mode switches the active operator auth token (baseline ↔ elevated), forces a WebSocket reconnect, and keeps admin actions explicitly gated by Admin Mode.
- **Non-goals:** Redesign Admin Mode UI, change gateway/auth server behavior, add new dependencies, or refactor operator-core internals beyond what desktop needs.
- **Constraints:** TypeScript strict + ESM, no new deps, preserve existing desktop IPC HTTP fetch path, keep changes localized to `apps/desktop` where possible.
- **Plan:** Reuse the existing “recreate OperatorCore on auth change” pattern from the web app: add a small desktop core manager, wire it into `Gateway.tsx`, and add unit tests for the manager behavior.
- **Risks & rollback:** Risk of reconnection loops if auth is recomputed on every admin tick; mitigate by comparing auth equality before recreating. Rollback is reverting the manager wiring (desktop operator UI will still render but admin actions won’t work).

---

## Background

The desktop app renders the operator UI via `apps/desktop/src/renderer/pages/Gateway.tsx`, constructing an `OperatorCore` with a baseline bearer token and an IPC-backed HTTP fetch.

The operator UI already includes Admin Mode UI (banner + enter/exit flow) and gating components, but the desktop renderer does not currently switch the active auth token used by the `OperatorCore` when Admin Mode is entered/exited. As a result, privileged actions can remain unauthorized or use stale scopes.

## Acceptance Criteria (from #641)

- Admin Mode can be entered/exited from the desktop UI.
- Token switching triggers WS reconnect (no stale scopes).
- Admin-only actions are blocked unless Admin Mode is active.

## Options Considered

### Option A: Add dynamic auth switching inside `@tyrum/operator-core`

**Pros:** One implementation for all consumers.  
**Cons:** Requires “hot-swappable” WS/HTTP clients and store dependency re-wiring; higher risk and broader blast radius.

### Option B (Recommended): Recreate `OperatorCore` in desktop when selected auth changes

**Pros:** Small change, matches existing pattern in `apps/web` (`createWebOperatorCoreManager`), guarantees WS reconnect and HTTP auth update by construction, keeps Admin Mode store stable across core swaps.  
**Cons:** Requires a small manager layer in desktop and careful cleanup/dispose to avoid leaks.

### Option C: Wrap clients with a “switchable” facade

**Pros:** Avoids recreating stores/core.  
**Cons:** Complex event forwarding, subscription replay, and lifecycle management; easy to get wrong.

## Proposed Design (Option B)

### Key idea

Introduce a desktop-side “OperatorCore manager” that:

1. Holds the **current** `OperatorCore` and the **current selected auth**.
2. Subscribes to a shared `AdminModeStore`.
3. Recomputes selected auth via `selectAuthForAdminMode({ baseline, adminMode })`.
4. When auth changes, **creates a new `OperatorCore`**, disposes the old one, and reconnects if the previous core was connected/connecting.

### Desktop renderer integration

- Create a single `AdminModeStore` instance for the session.
- Create a baseline `OperatorAuthStrategy` from the desktop-provided token.
- Build an `OperatorCore` factory that:
  - Creates an IPC-backed `@tyrum/client` HTTP client using `httpAuthForAuth(auth)` and the desktop IPC fetch.
  - Creates `OperatorCore` with the shared `AdminModeStore` and the newly created HTTP client dependency.
- Render `OperatorUiApp` with the manager’s current core; update React state when the manager swaps cores.

### Testing

Add unit tests for the manager:

- Entering Admin Mode (elevated token) recreates the core and calls `connect()` when previously connected/connecting.
- Exiting/expiring Admin Mode recreates the core back to baseline auth and reconnects when needed.
- Admin Mode “tick” updates that do not change the selected auth do **not** recreate the core.


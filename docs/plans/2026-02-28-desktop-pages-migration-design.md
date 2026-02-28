# Desktop Pages Migration (Desktop Renderer) — Design

**Issue:** #742 — Desktop pages migration

## Goal

Migrate the desktop renderer UI away from `apps/desktop/src/renderer/theme.ts` (inline `CSSProperties`)
to shared `@tyrum/operator-ui` components + Tailwind utility classes, while keeping the existing desktop
IPC + main-process behavior unchanged.

## Non-goals

- Changing Electron main-process behavior (window management, IPC contracts, deep link handling).
- Refactoring gateway/node runtime logic.

## Approach

### Shared theme + tokens

- Use `@tyrum/operator-ui` `ThemeProvider` at the desktop renderer root so desktop supports
  `system` / `light` / `dark` modes consistently with the operator UI token system.
- Delete `apps/desktop/src/renderer/theme.ts` and remove the desktop theme-sync bootstrap (`startDesktopThemeSync`).

To avoid multiple theme sources fighting over `documentElement.dataset.theme` on the Gateway page,
`@tyrum/operator-ui` `OperatorUiApp` should not mount a nested `ThemeProvider` when one already exists.

### Shared layout + navigation

- Replace desktop `Layout` with `@tyrum/operator-ui` `AppShell`.
- Replace desktop `Sidebar` with `@tyrum/operator-ui` `Sidebar`, configured with the desktop navigation items:
  Overview, Gateway, Connection, Permissions, Diagnostics, Logs.

### Modal + pages

- Rebuild `ConsentModal` visuals using `@tyrum/operator-ui` `Dialog` while keeping the existing IPC logic.
- Migrate the six desktop pages (Overview, Gateway, Connection, Permissions, Diagnostics, Logs) to Tailwind +
  shared components (`Card`, `Button`, `Badge`, `StatusDot`, `Tabs`, `Input`, `Textarea`, `RadioGroup`, `Switch`,
  `ScrollArea`, etc.).

### Operator UI desktop setup page

- Rebuild the `DesktopSetupPage` inside `packages/operator-ui/src/app.tsx` to use the shared UI components
  consistently (no raw/styled inputs outside the shared primitives).

## Testing + verification

Automated:

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`

Manual (desktop app):

- Launch the desktop app; verify all six desktop pages render correctly.
- Toggle theme mode; verify all pages update.
- Trigger a consent request; verify the modal opens/closes and `consentRespond()` is called.

## Rollback

If the UI migration causes regressions, revert the PR branch commits (or revert the merged PR) to restore the
previous `theme.ts` + inline-style renderer implementation.

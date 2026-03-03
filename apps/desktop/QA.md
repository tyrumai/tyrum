# Desktop QA matrix (native behaviors)

This checklist is for manual QA of “native feel” behaviors across macOS, Windows, and Linux.

## Preflight

- [ ] `pnpm --filter tyrum-desktop test` is green
- [ ] Build type noted: dev (`pnpm --filter tyrum-desktop build && pnpm --filter tyrum-desktop dev`) or packaged (`pnpm --filter tyrum-desktop dist`)
- [ ] OS + version noted

## macOS

### Menus + shortcuts

- [ ] App menu includes **About**, **Preferences…** (`CmdOrCtrl+,`), **Hide/Hide Others/Show All**, **Quit**
- [ ] Invoking **Preferences…** (`CmdOrCtrl+,`) does not crash (renderer does not currently handle navigation requests)
- [ ] Standard shortcuts work (at least): `Cmd+Q`, `Cmd+W`, `Cmd+M`, `CmdOrCtrl+,`

### Window lifecycle

- [ ] Startup window does not show until ready (no blank/white flash)
- [ ] Single-instance behavior: launching the app again focuses/restores the existing window
- [ ] Dock icon click re-activates the app and re-opens the window if needed

### Window state

- [ ] Moving/resizing persists across relaunch
- [ ] Maximized state persists across relaunch
- [ ] If an external monitor is disconnected, relaunch still restores onto a visible display

### Theme + accessibility

- [ ] Follows OS light/dark mode changes (no restart required)
- [ ] Keyboard focus is visible for interactive controls
- [ ] Reduced motion / high contrast modes don’t break layout or navigation

### Deep links

- [ ] Starting the app via `tyrum://…` opens and focuses the app (renderer does not currently route deep links)
- [ ] While running, opening `tyrum://…` forwards to the existing instance (no second window)

### Update UX (packaged builds)

- [ ] Update UI is reachable/visible when an update is available
- [ ] Update install/restart flow does not lose user data or leave a zombie process

## Windows

### Menus + shortcuts

- [ ] Menu bar includes **File/Edit/View/Help**
- [ ] Invoking **Settings…** (`CmdOrCtrl+,`) does not crash (renderer does not currently handle navigation requests)
- [ ] Dev tools menu items only appear in dev builds

### Window lifecycle

- [ ] Startup window does not show until ready (no blank/white flash)
- [ ] Single-instance behavior: launching the app again focuses/restores the existing window
- [ ] Closing the last window quits the app (no background process unless intentionally packaged that way)

### Window state

- [ ] Moving/resizing persists across relaunch
- [ ] Maximized state persists across relaunch
- [ ] If a monitor is disconnected, relaunch still restores onto a visible display

### Theme + accessibility

- [ ] Follows OS light/dark mode changes (no restart required)
- [ ] Keyboard focus is visible for interactive controls
- [ ] Reduced motion / high contrast modes don’t break layout or navigation

### Deep links

- [ ] Starting the app via `tyrum://…` opens and focuses the app (renderer does not currently route deep links)
- [ ] While running, opening `tyrum://…` forwards to the existing instance (no second window)

### Update UX (packaged builds)

- [ ] Update UI is reachable/visible when an update is available
- [ ] Update install/restart flow does not lose user data or leave a zombie process

## Linux

### Menus + shortcuts

- [ ] Menu bar includes **File/Edit/View/Help** (or the platform equivalent)
- [ ] Invoking **Settings…** (`CmdOrCtrl+,`) does not crash (renderer does not currently handle navigation requests)
- [ ] Dev tools menu items only appear in dev builds

### Window lifecycle

- [ ] Startup window does not show until ready (no blank/white flash)
- [ ] Single-instance behavior: launching the app again focuses/restores the existing window
- [ ] Closing the last window quits the app

### Window state

- [ ] Moving/resizing persists across relaunch
- [ ] Maximized state persists across relaunch (where supported by WM)
- [ ] If a monitor is disconnected, relaunch still restores onto a visible display

### Theme + accessibility

- [ ] Follows OS light/dark mode changes (no restart required)
- [ ] Keyboard focus is visible for interactive controls
- [ ] Reduced motion / high contrast modes don’t break layout or navigation

### Deep links

- [ ] Starting the app via `tyrum://…` opens and focuses the app (renderer does not currently route deep links)
- [ ] While running, opening `tyrum://…` forwards to the existing instance (no second window)

### Update UX (packaged builds)

- [ ] Update UI is reachable/visible when an update is available
- [ ] Update install/restart flow does not lose user data or leave a zombie process

## Automated regression coverage (targeted)

Highest-risk “native behavior” logic is covered by unit/integration tests:

- Single instance + argv forwarding: `apps/desktop/tests/single-instance.test.ts`, `apps/desktop/tests/main-deep-links.test.ts`
- Deep link argv parsing: `apps/desktop/tests/deep-links.test.ts`
- Application menu template: `apps/desktop/tests/menu-template.test.ts`
- Context menu template + registration: `apps/desktop/tests/context-menu.test.ts`
- Ensure-visible window bounds: `apps/desktop/tests/window-state.test.ts`

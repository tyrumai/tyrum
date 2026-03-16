# Desktop app

## Purpose

The Tyrum desktop app bundles the shared UI and provides
desktop-local integrations (permissions, updates, deep links) plus embedded gateway/node workflows.

This app lives in `apps/desktop/`.

## Prerequisites

- Node.js 24.x and pnpm 10.x (workspace standard).
- macOS / Linux / Windows.
- Playwright browsers (for running the desktop test suite):

```bash
pnpm --filter tyrum-desktop exec playwright install --with-deps
```

## Build

From the repo root:

```bash
pnpm install
pnpm --filter tyrum-desktop build
```

To stage the embedded gateway bundle used by packaged releases:

```bash
pnpm --filter tyrum-desktop build:gateway
```

To produce platform installers/artifacts (runs `build:gateway` + `build` + `electron-builder`):

```bash
pnpm --filter tyrum-desktop dist
```

Artifacts are written under `apps/desktop/release/`.

## Development

Run the app from the locally-built `dist/` output:

```bash
pnpm --filter tyrum-desktop build
pnpm --filter tyrum-desktop dev
```

Run tests:

```bash
pnpm --filter tyrum-desktop test
```

Manual QA checklist for native-feel behaviors: `apps/desktop/QA.md`.

## Architecture

Key directories:

- `apps/desktop/src/main/` — Electron main process (window lifecycle, IPC handlers, embedded
  gateway/node management, updates, deep links).
- `apps/desktop/src/preload/` — preload scripts; exposes the `window.tyrumDesktop` bridge via
  `contextBridge`.
- `apps/desktop/src/renderer/` — Vite + React renderer; bootstraps `@tyrum/operator-ui`’s
  `OperatorUiApp` and wires desktop operator-core boot via `window.tyrumDesktop`.

IPC:

- Main-side handlers live in `apps/desktop/src/main/ipc/`.
- Renderer calls go through the preload bridge (no direct Node access from the renderer).

Config:

- Stored at `~/.tyrum/desktop-node.json` (or `$TYRUM_HOME/desktop-node.json`).

## Packaging assets (icons)

The canonical mascot source now lives in `assets/brand/` and the consumer-specific desktop outputs
still live in `apps/desktop/build/`:

- Source of truth: `../../assets/brand/app-icon.svg`
- Generated desktop mirror: `build/icon.svg`
- Generated (committed):
  - `build/icon.icns` (macOS)
  - `build/icon.ico` (Windows + NSIS)
  - `build/icons/*.png` (Linux icon set)
  - `build/tray-macos-template.svg` (shared monochrome mascot template for the macOS tray icon)

The same generator also refreshes web, docs, and mobile launcher assets from that shared source.

To regenerate deterministically (requires `magick` from ImageMagick):

```bash
pnpm icons:generate
# or
pnpm --filter tyrum-desktop icons:generate
```

## Verifying icons locally

Build the desktop artifacts on each target OS and check the icons on the generated installers and the installed app:

- Linux: `pnpm --filter tyrum-desktop dist` → inspect `apps/desktop/release/*` and the running app’s taskbar icon.
- macOS: run the `release` workflow (or `pnpm --filter tyrum-desktop dist`) → verify `.dmg`/`.app` icons in Finder + Dock.
- Windows: run the `release` workflow (or `pnpm --filter tyrum-desktop dist`) → verify NSIS installer icon + Start Menu/Desktop shortcut icon.

## Release workflow expectations

Release builds are produced by `.github/workflows/release.yml`.

- macOS: signing + notarization are handled when the required Apple and `CSC_*` secrets are configured.
- Windows: the workflow will sign builds if a code-signing certificate is configured (see `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` in `release.yml`). If not set, Windows artifacts are published unsigned.

If/when Windows signing is enabled, consider setting `win.publisherName` in `electron-builder.yml` to the signing certificate subject so `electron-updater` can enforce signature verification for downloaded updates.

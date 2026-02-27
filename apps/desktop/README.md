# Tyrum Desktop

## Packaging assets (icons)

Electron-builder consumes icons from `apps/desktop/build/`:

- Source: `build/icon.svg` (authoritative)
- Generated (committed):
  - `build/icon.icns` (macOS)
  - `build/icon.ico` (Windows + NSIS)
  - `build/icons/*.png` (Linux icon set)

To regenerate deterministically (requires `magick` from ImageMagick):

```bash
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

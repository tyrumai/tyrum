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

## Release workflow expectations

Release builds are produced by `.github/workflows/release.yml`.

- macOS: signing + notarization are handled when the required Apple and `CSC_*` secrets are configured.
- Windows: the workflow will sign builds if a code-signing certificate is configured (see `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` in `release.yml`, falling back to `CSC_LINK` / `CSC_KEY_PASSWORD`). If not set, Windows artifacts are published unsigned.

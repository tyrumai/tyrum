# `@tyrum/mobile`

Capacitor mobile shell for Tyrum operator UI and the local iOS/Android node runtime.

## Commands

- `pnpm --filter @tyrum/mobile dev`
- `pnpm --filter @tyrum/mobile build`
- `pnpm --filter @tyrum/mobile typecheck`
- `pnpm --filter @tyrum/mobile cap:add:ios`
- `pnpm --filter @tyrum/mobile cap:add:android`
- `pnpm --filter @tyrum/mobile cap:sync`
- `pnpm --filter @tyrum/mobile cap:open:ios`
- `pnpm --filter @tyrum/mobile cap:open:android`

## Notes

- The app is remote-gateway only in v1.
- Secrets are stored with `@aparajita/capacitor-secure-storage`.
- Non-secret mobile config is stored with `@capacitor/preferences`.
- The local mobile node advertises `tyrum.ios` or `tyrum.android` and supports:
  - `location.get_current`
  - `camera.capture_photo`
  - `audio.record_clip`
- Native iOS/Android projects are generated with `cap:add:*` and kept out of this initial repo diff.

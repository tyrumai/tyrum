# `@tyrum/mobile`

Capacitor mobile shell for Tyrum operator UI and the local iOS/Android node runtime.

## Prerequisites

- Repo toolchain: Node `24` and pnpm `10`
- Shared workspace install: `pnpm install`
- iOS: macOS with Xcode and the iOS Simulator toolchain
- Android: Android Studio, Android SDK Platform `36`, Build Tools `36.0.0`, and JDK `21`

## Commands

- `pnpm --filter @tyrum/mobile build`
- `pnpm --filter @tyrum/mobile typecheck`
- `pnpm --filter @tyrum/mobile test`
- `pnpm --filter @tyrum/mobile ios:sync`
- `pnpm --filter @tyrum/mobile ios:build`
- `pnpm --filter @tyrum/mobile ios:open`
- `pnpm --filter @tyrum/mobile android:sync`
- `pnpm --filter @tyrum/mobile android:build`
- `pnpm --filter @tyrum/mobile android:open`

## Native Project Layout

- `apps/mobile/ios` and `apps/mobile/android` are tracked in git.
- `cap sync` output that changes often stays ignored:
  - copied web assets
  - generated Capacitor config files
  - CocoaPods/build output
  - Gradle build output and local SDK config
- After dependency or native-config changes, run the matching `*:sync` command and keep tracked native scaffolding clean.

## Local Test Setup

1. Install workspace dependencies:

   ```bash
   pnpm install
   ```

2. Start a local gateway and capture the bootstrap token it prints on first run:

   ```bash
   pnpm --filter @tyrum/gateway start -- --host 127.0.0.1 --port 8788
   ```

3. Verify the mobile app before opening native IDEs:

   ```bash
   pnpm --filter @tyrum/mobile typecheck
   pnpm --filter @tyrum/mobile test
   ```

## Test On iOS

- Build and sync the native project:

  ```bash
  pnpm --filter @tyrum/mobile ios:build
  ```

- Open the Xcode workspace:

  ```bash
  pnpm --filter @tyrum/mobile ios:open
  ```

- In the app bootstrap screen use:
  - HTTP base URL: `http://127.0.0.1:8788`
  - WebSocket URL: `ws://127.0.0.1:8788/ws`
  - Bearer token: the gateway bootstrap token
- Expected smoke path:
  - app launches
  - bootstrap form saves
  - operator UI connects
  - the mobile platform page is visible
  - node enable/disable and action toggles persist after relaunch
- Simulator notes:
  - location can be tested with Simulator -> Features -> Location
  - camera and microphone validation should be done on a physical iPhone/iPad

## Test On Android

- Build and sync the native project:

  ```bash
  pnpm --filter @tyrum/mobile android:build
  ```

- Open Android Studio:

  ```bash
  pnpm --filter @tyrum/mobile android:open
  ```

- In the Android emulator bootstrap screen use:
  - HTTP base URL: `http://10.0.2.2:8788`
  - WebSocket URL: `ws://10.0.2.2:8788/ws`
  - Bearer token: the gateway bootstrap token
- Expected smoke path:
  - app launches
  - bootstrap form saves
  - operator UI connects
  - the mobile platform page is visible
  - node enable/disable and action toggles persist after relaunch
- Emulator notes:
  - location can be tested from the emulator Extended Controls -> Location panel
  - camera and microphone validation should be done on a physical Android device when possible

## Test On Physical Devices

- Start the gateway on a reachable interface:

  ```bash
  pnpm --filter @tyrum/gateway start -- --host 0.0.0.0 --port 8788
  ```

- Use the host machine LAN address instead of loopback:
  - iOS/Android HTTP base URL: `http://<lan-ip>:8788`
  - iOS/Android WebSocket URL: `ws://<lan-ip>:8788/ws`
- Keep the phone/tablet on the same network as the gateway host.
- Use physical devices for final camera and audio checks.

## Notes

- The app is remote-gateway only in v1.
- Secrets are stored with `@aparajita/capacitor-secure-storage`.
- Non-secret mobile config is stored with `@capacitor/preferences`.
- The local mobile node advertises `tyrum.ios` or `tyrum.android` and supports:
  - `location.get_current`
  - `camera.capture_photo`
  - `audio.record_clip`
- Local mobile node support is only enabled on Capacitor iOS and Android targets, not the browser `vite` dev server.
- Manual QA checklist: [`QA.md`](./QA.md)
- Keep the `tyrum://bootstrap` deep-link scheme, Android intent filter, and camera permission strings in sync when updating native QR onboarding support.

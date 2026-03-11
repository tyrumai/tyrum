# Mobile QA Matrix

This checklist covers manual smoke testing for the tracked native iOS and Android shells.

## Preflight

- [ ] `pnpm install`
- [ ] `pnpm --filter @tyrum/mobile typecheck`
- [ ] `pnpm --filter @tyrum/mobile test`
- [ ] Gateway started and bootstrap token captured
- [ ] Test target noted: iOS simulator, Android emulator, or physical device

## iOS Simulator

- [ ] `pnpm --filter @tyrum/mobile ios:build`
- [ ] `pnpm --filter @tyrum/mobile ios:open`
- [ ] App launches in the simulator without a blank screen or native crash
- [ ] Bootstrap form accepts:
  - HTTP `http://127.0.0.1:8788`
  - WebSocket `ws://127.0.0.1:8788/ws`
  - bootstrap token
- [ ] Operator UI connects after saving config
- [ ] Mobile platform page is visible
- [ ] Toggling node enabled state updates the UI and survives relaunch
- [ ] Toggling mobile actions updates the UI and survives relaunch
- [ ] Location permission prompt appears and simulated location works
- [ ] App relaunch keeps the saved config

## Android Emulator

- [ ] `pnpm --filter @tyrum/mobile android:build`
- [ ] `pnpm --filter @tyrum/mobile android:open`
- [ ] App launches in the emulator without a blank screen or native crash
- [ ] Bootstrap form accepts:
  - HTTP `http://10.0.2.2:8788`
  - WebSocket `ws://10.0.2.2:8788/ws`
  - bootstrap token
- [ ] Operator UI connects after saving config
- [ ] Mobile platform page is visible
- [ ] Toggling node enabled state updates the UI and survives relaunch
- [ ] Toggling mobile actions updates the UI and survives relaunch
- [ ] Location permission prompt appears and emulator location injection works
- [ ] App relaunch keeps the saved config

## Physical Device Pass

- [ ] Gateway started with `--host 0.0.0.0`
- [ ] Device uses reachable LAN URLs instead of loopback
- [ ] Camera capture succeeds
- [ ] Microphone recording succeeds
- [ ] Location succeeds with device permissions enabled
- [ ] Disconnecting/reconnecting network produces a recoverable error state
- [ ] Relaunch keeps saved gateway config and node settings

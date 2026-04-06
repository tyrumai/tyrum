# `@tyrum/operator-app`

Shared, renderer-agnostic operator state + actions built on top of `@tyrum/transport-sdk` (WS + HTTP).
This package is the client-side foundation used by the web app, desktop app, mobile app, and TUI.

## Usage

```ts
import { createOperatorCore, createBearerTokenAuth } from "@tyrum/operator-app";

const core = createOperatorCore({
  wsUrl: "ws://127.0.0.1:8788/ws",
  httpBaseUrl: "http://127.0.0.1:8788",
  auth: createBearerTokenAuth(process.env.GATEWAY_TOKEN ?? ""),
});

core.connect();
```

### React / Ink subscription

All domain stores implement a minimal “external store” interface compatible with `useSyncExternalStore`:

```ts
import { useSyncExternalStore } from "react";

const connection = useSyncExternalStore(
  core.connectionStore.subscribe,
  core.connectionStore.getSnapshot,
);
```

## Auth strategies

- `createBrowserCookieAuth()` — cookie-based auth for browser environments (HTTP uses `credentials: include`; WS relies on same-origin cookies).
- `createBearerTokenAuth(token)` — bearer token for HTTP + WS subprotocol token (desktop/cli/tui).

## Stores (state + actions)

### `connectionStore`

**State:** `ConnectionState`

- `status`: `"disconnected" | "connecting" | "connected"`
- `clientId`: `string | null`
- `lastDisconnect`: `{ code, reason } | null`
- `transportError`: `string | null`

**Actions:**

- `connect()`
- `disconnect()`

### `approvalsStore`

**State:** `ApprovalsState`

- `byId`: `Record<number, Approval>`
- `pendingIds`: `number[]`
- `loading`: `boolean`
- `error`: `string | null`
- `lastSyncedAt`: `string | null`

**Actions:**

- `refreshPending()` — WS control-plane list (pending)
- `resolve(approvalId, decision, reason?)` — WS control-plane resolve

### `turnsStore`

**State:** `TurnsState`

- `turnsById`: `Record<string, Turn>`
- `turnItemsById`: `Record<string, TurnItem>`
- `turnItemIdsByTurnId`: `Record<string, string[]>`
- `agentKeyByTurnId`: `Record<string, string>`
- `conversationKeyByTurnId`: `Record<string, string>`
- `triggerKindByTurnId`: `Record<string, TurnTriggerKind>`

**Actions:** none (event-driven upserts)

### `activityStore`

**State:** `ActivityState`

- ephemeral message-activity workstreams keyed by `conversationId` (or `threadId` when needed)
- deterministic workstream ordering and default selection for the Activity inspector
- per-workstream persona, current room, attention level, bubble text, and recent events derived from typing/message/delivery activity

**Actions:**

- `selectWorkstream(workstreamId)`
- `clearSelection()`

### `pairingStore`

**State:** `PairingState`

- `byId`: `Record<number, NodePairingRequest>`
- `pendingIds`: `number[]`
- `loading`: `boolean`
- `error`: `string | null`
- `lastSyncedAt`: `string | null`

**Actions:**

- `refresh()` — HTTP list
- `approve(pairingId, input)`
- `deny(pairingId, input?)`
- `revoke(pairingId, input?)`

### `statusStore`

**State:** `StatusState`

- `status`: `StatusResponse | null`
- `usage`: `UsageResponse | null`
- `presenceByInstanceId`: `Record<string, PresenceEntry>`
- `loading`: `{ status, usage, presence }`
- `error`: `{ status, usage, presence }`
- `lastSyncedAt`: `string | null`

**Actions:**

- `refreshStatus()`
- `refreshUsage(query?)`
- `refreshPresence()`

### `workboardStore`

Tracks WorkBoard items, tasks, drilldown records, and selection state for the operator work view.

### `chatStore`

Tracks conversation/chat threads, active conversation state, and live AI SDK chat updates used by
operator clients.

### `agentStatusStore`

Tracks agent inventory and high-level status summaries used by the operator dashboard and agent
management surfaces.

### `desktopEnvironmentHostsStore` / `desktopEnvironmentsStore`

Track gateway-managed desktop environment hosts, lifecycle state, logs, and related admin actions.

### `elevatedModeStore`

Tracks time-bounded elevated mode used to unlock admin or mutating operations from operator
surfaces.

### `autoSyncStore`

Tracks background sync work scheduled after reconnects and explicit refreshes.

## Surface summary

`createOperatorCore()` returns a single object that owns:

- WebSocket + HTTP clients
- connection lifecycle controls
- elevated-mode state
- approvals, turns, pairing, status, workboard, chat, activity, and agent-status stores
- desktop-environment stores for operator/admin surfaces
- reconnect-driven best-effort resync via `syncAllNow()`

## Reconnect semantics

On WS `connected`, operator-core triggers a best-effort re-sync:

- `approvalsStore.refreshPending()`
- `pairingStore.refresh()`
- `statusStore.refreshStatus()`
- `statusStore.refreshPresence()`
- `statusStore.refreshUsage()`

Live WS events continue to upsert domain state between refreshes.

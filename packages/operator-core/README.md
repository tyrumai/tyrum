# `@tyrum/operator-core`

Shared, renderer-agnostic operator state + actions built on top of `@tyrum/client` (WS + HTTP).

## Usage

```ts
import { createOperatorCore, createBearerTokenAuth } from "@tyrum/operator-core";

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

### `runsStore`

**State:** `RunsState`

- `runsById`: `Record<string, ExecutionRun>`
- `stepsById`: `Record<string, ExecutionStep>`
- `attemptsById`: `Record<string, ExecutionAttempt>`
- `stepIdsByRunId`: `Record<string, string[]>`
- `attemptIdsByStepId`: `Record<string, string[]>`

**Actions:** none (event-driven upserts)

### `activityStore`

**State:** `ActivityState`

- agent-grouped workstreams keyed by `key + lane`
- deterministic workstream ordering and default selection for the Activity inspector
- per-workstream persona, current room, run status, latest run id, queue count, lease state, attention level, bubble text, and recent events

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

## Reconnect semantics

On WS `connected`, operator-core triggers a best-effort re-sync:

- `approvalsStore.refreshPending()`
- `pairingStore.refresh()`
- `statusStore.refreshStatus()`
- `statusStore.refreshPresence()`
- `statusStore.refreshUsage()`

Live WS events continue to upsert domain state between refreshes.

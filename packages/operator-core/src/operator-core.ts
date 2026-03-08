import {
  TyrumClient,
  createTyrumHttpClient,
  type DeviceIdentity,
  type Approval,
  type ClientCapability,
  type ExecutionAttempt,
  type ExecutionRun,
  type ExecutionStep,
  type MemoryItemId,
  type MemoryItem,
  type MemoryTombstone,
  type TyrumClientEvents,
} from "@tyrum/client/browser";
import { httpAuthForAuth, wsTokenForAuth, type OperatorAuthStrategy } from "./auth.js";
import type { OperatorHttpClient, OperatorWsClient } from "./deps.js";
import type { Unsubscribe } from "./store.js";
import { createApprovalsStore, type ApprovalsStore } from "./stores/approvals-store.js";
import { createConnectionStore, type ConnectionStore } from "./stores/connection-store.js";
import { createPairingStore, type Pairing, type PairingStore } from "./stores/pairing-store.js";
import { createRunsStore, type RunsStore } from "./stores/runs-store.js";
import { createElevatedModeStore, type ElevatedModeStore } from "./stores/elevated-mode-store.js";
import {
  createStatusStore,
  type OperatorPresenceEntry,
  type StatusStore,
} from "./stores/status-store.js";
import { createMemoryStore, type MemoryStore } from "./stores/memory-store.js";
import { createChatStore, type ChatStore } from "./stores/chat-store.js";
import { createAutoSyncManager, type AutoSyncState, type AutoSyncTask } from "./auto-sync.js";
import { createWorkboardStore, type WorkboardStore } from "./stores/workboard-store.js";
import { createAgentStatusStore, type AgentStatusStore } from "./stores/agent-status-store.js";
import { createActivityStore, type ActivityStore } from "./stores/activity-store.js";
import { registerActivityWsHandlers } from "./operator-core.activity-events.js";
import type { WorkItem } from "@tyrum/schemas";
import type { WorkTaskEvent } from "./workboard/workboard-utils.js";

export interface OperatorCoreOptions {
  wsUrl: string;
  httpBaseUrl: string;
  auth: OperatorAuthStrategy;
  capabilities?: ClientCapability[];
  deviceIdentity?: DeviceIdentity;
  elevatedModeStore?: ElevatedModeStore;
  deps?: {
    ws?: OperatorWsClient;
    http?: Partial<OperatorHttpClient>;
  };
}

export interface OperatorCore {
  wsUrl: string;
  httpBaseUrl: string;
  deviceId?: string | null;
  ws: OperatorWsClient;
  http: OperatorHttpClient;
  elevatedModeStore: ElevatedModeStore;
  connectionStore: ConnectionStore;
  autoSyncStore: import("./store.js").ExternalStore<AutoSyncState>;
  approvalsStore: ApprovalsStore;
  runsStore: RunsStore;
  pairingStore: PairingStore;
  statusStore: StatusStore;
  memoryStore: MemoryStore;
  workboardStore: WorkboardStore;
  agentStatusStore: AgentStatusStore;
  chatStore: ChatStore;
  activityStore: ActivityStore;
  syncAllNow(): Promise<void>;
  connect(): void;
  disconnect(): void;
  dispose(): void;
}

function readClientId(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>)["clientId"];
  if (typeof raw !== "string") return null;
  const clientId = raw.trim();
  return clientId.length > 0 ? clientId : null;
}

function readDisconnect(data: unknown): { code: number; reason: string } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const rec = data as Record<string, unknown>;
  const code = rec["code"];
  const reason = rec["reason"];
  if (typeof code !== "number") return null;
  if (typeof reason !== "string") return null;
  return { code, reason };
}

function readTransportMessage(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>)["message"];
  return typeof raw === "string" ? raw : null;
}

function readOccurredAt(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>)["occurred_at"];
  return typeof raw === "string" ? raw : null;
}

function readReconnectSchedule(data: unknown): number | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>)["nextRetryAtMs"];
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw)) return null;
  return raw;
}

function readPayload(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const payload = (data as Record<string, unknown>)["payload"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

export function createOperatorCore(options: OperatorCoreOptions): OperatorCore {
  const elevatedModeStore = options.elevatedModeStore ?? createElevatedModeStore();
  const elevatedModeStoreOwned = options.elevatedModeStore === undefined;

  const ws: OperatorWsClient =
    options.deps?.ws ??
    new TyrumClient({
      url: options.wsUrl,
      token: wsTokenForAuth(options.auth),
      capabilities: options.capabilities ?? [],
      device: options.deviceIdentity
        ? {
            deviceId: options.deviceIdentity.deviceId,
            publicKey: options.deviceIdentity.publicKey,
            privateKey: options.deviceIdentity.privateKey,
          }
        : undefined,
    });

  const baseHttp: OperatorHttpClient = createTyrumHttpClient({
    baseUrl: options.httpBaseUrl,
    auth: httpAuthForAuth(options.auth),
  });
  const http: OperatorHttpClient = options.deps?.http
    ? { ...baseHttp, ...options.deps.http }
    : baseHttp;

  const connection = createConnectionStore(ws);
  const approvals = createApprovalsStore(ws);
  const pairing = createPairingStore(http);
  const status = createStatusStore(http);
  const runs = createRunsStore();
  const memory = createMemoryStore(ws);
  const chat = createChatStore(ws, http);
  const workboard = createWorkboardStore(ws);
  const agentStatus = createAgentStatusStore(http);
  const activity = createActivityStore({
    runsStore: runs.store,
    approvalsStore: approvals.store,
    statusStore: status.store,
    memoryStore: memory.store,
    chatStore: chat,
  });

  const warmStores = {
    approvalsStore: approvals.store,
    pairingStore: pairing.store,
    statusStore: status.store,
    memoryStore: memory.store,
    workboardStore: workboard.store,
    agentStatusStore: agentStatus.store,
  } as const;

  const syncRegistry: { [K in keyof typeof warmStores]: AutoSyncTask[] } = {
    approvalsStore: [
      {
        id: "approvals.refreshPending",
        run: async () => {
          await approvals.store.refreshPending();
          const error = approvals.store.getSnapshot().error;
          if (error) throw new Error(error);
        },
      },
    ],
    pairingStore: [
      {
        id: "pairings.refresh",
        run: async () => {
          await pairing.store.refresh();
          const error = pairing.store.getSnapshot().error;
          if (error) throw new Error(error);
        },
      },
    ],
    statusStore: [
      {
        id: "status.refreshStatus",
        run: async () => {
          await status.store.refreshStatus();
          const error = status.store.getSnapshot().error.status;
          if (error) throw new Error(error);
        },
      },
      {
        id: "status.refreshPresence",
        run: async () => {
          await status.store.refreshPresence();
          const error = status.store.getSnapshot().error.presence;
          if (error) throw new Error(error);
        },
      },
      {
        id: "status.refreshUsage",
        run: async () => {
          await status.store.refreshUsage();
          const error = status.store.getSnapshot().error.usage;
          if (error) throw new Error(error);
        },
      },
    ],
    memoryStore: [
      {
        id: "memory.refreshBrowse",
        run: async () => {
          await memory.store.refreshBrowse();
          const snapshot = memory.store.getSnapshot();
          if (!snapshot.browse.request) return;
          const error = snapshot.browse.error;
          if (error) throw new Error(error.message);
        },
      },
    ],
    workboardStore: [
      {
        id: "workboard.refreshList",
        enabled: () => workboard.store.getSnapshot().supported !== false,
        run: async () => {
          await workboard.store.refreshList();
          const error = workboard.store.getSnapshot().error;
          if (error) throw new Error(error);
        },
      },
    ],
    agentStatusStore: [
      {
        id: "agentStatus.refresh",
        run: async () => {
          await agentStatus.store.refresh();
          const error = agentStatus.store.getSnapshot().error;
          if (error) throw new Error(error);
        },
      },
    ],
  };

  const autoSync = createAutoSyncManager({
    intervalMs: 30_000,
    isConnected: () => connection.store.getSnapshot().status === "connected",
    nowMs: () => Date.now(),
    random: () => Math.random(),
    tasks: (Object.keys(warmStores) as (keyof typeof warmStores)[]).flatMap(
      (key) => syncRegistry[key],
    ),
  });

  const unsubscribes: Unsubscribe[] = [];
  const on = (event: keyof TyrumClientEvents, handler: (data: unknown) => void): void => {
    ws.on(event, handler);
    unsubscribes.push(() => {
      ws.off(event, handler);
    });
  };

  on("connected", (data) => {
    const clientId = readClientId(data);
    connection.handleConnected(clientId);
    workboard.store.resetSupportProbe();
    void autoSync.handleConnected();
  });

  on("disconnected", (data) => {
    const dis = readDisconnect(data);
    if (dis) {
      connection.handleDisconnected(dis.code, dis.reason);
    }
  });

  on("transport_error", (data) => {
    const message = readTransportMessage(data);
    if (message) {
      connection.handleTransportError(message);
    }
  });

  on("reconnect_scheduled", (data) => {
    const nextRetryAtMs = readReconnectSchedule(data);
    if (nextRetryAtMs !== null) {
      connection.handleReconnectScheduled(nextRetryAtMs);
    }
  });

  on("approval.requested", (data) => {
    const payload = readPayload(data);
    const approval = payload?.["approval"];
    if (approval) {
      approvals.handleApprovalUpsert(approval as Approval);
    }
  });

  on("approval.resolved", (data) => {
    const payload = readPayload(data);
    const approval = payload?.["approval"];
    if (approval) {
      approvals.handleApprovalUpsert(approval as Approval);
    }
  });

  on("pairing.requested", (data) => {
    const payload = readPayload(data);
    const pairingReq = payload?.["pairing"];
    if (pairingReq) {
      pairing.handlePairingUpsert(pairingReq as Pairing);
    }
  });

  on("pairing.approved", (data) => {
    const payload = readPayload(data);
    const pairingReq = payload?.["pairing"];
    if (pairingReq) {
      pairing.handlePairingUpsert(pairingReq as Pairing);
    }
  });

  on("pairing.resolved", (data) => {
    const payload = readPayload(data);
    const pairingReq = payload?.["pairing"];
    if (pairingReq) {
      pairing.handlePairingUpsert(pairingReq as Pairing);
    }
  });

  on("presence.upserted", (data) => {
    const payload = readPayload(data);
    const entry = payload?.["entry"];
    if (entry) {
      status.handlePresenceUpsert(entry as OperatorPresenceEntry);
    }
  });

  on("presence.pruned", (data) => {
    const payload = readPayload(data);
    const instanceId = payload?.["instance_id"];
    if (typeof instanceId === "string") {
      status.handlePresencePruned(instanceId);
    }
  });

  on("memory.item.created", (data) => {
    const payload = readPayload(data);
    const item = payload?.["item"];
    if (item) {
      memory.handleMemoryItemUpsert(item as MemoryItem);
    }
  });

  on("memory.item.updated", (data) => {
    const payload = readPayload(data);
    const item = payload?.["item"];
    if (item) {
      memory.handleMemoryItemUpsert(item as MemoryItem);
    }
  });

  on("memory.item.consolidated", (data) => {
    const payload = readPayload(data);
    const fromIds = payload?.["from_memory_item_ids"];
    const item = payload?.["item"];
    if (item && Array.isArray(fromIds) && fromIds.every((id) => typeof id === "string")) {
      memory.handleMemoryConsolidated(fromIds as MemoryItemId[], item as MemoryItem);
      return;
    }
    if (item) {
      memory.handleMemoryItemUpsert(item as MemoryItem);
    }
  });

  on("memory.item.deleted", (data) => {
    const payload = readPayload(data);
    const tombstone = payload?.["tombstone"];
    if (tombstone) {
      memory.handleMemoryTombstone(tombstone as MemoryTombstone);
    }
  });

  on("memory.item.forgotten", (data) => {
    const payload = readPayload(data);
    const tombstone = payload?.["tombstone"];
    if (tombstone) {
      memory.handleMemoryTombstone(tombstone as MemoryTombstone);
    }
  });

  on("memory.export.completed", (data) => {
    const payload = readPayload(data);
    const artifactId = payload?.["artifact_id"];
    if (typeof artifactId === "string") {
      memory.handleMemoryExportCompleted(artifactId);
    }
  });

  on("run.updated", (data) => {
    const payload = readPayload(data);
    const run = payload?.["run"];
    if (run) {
      runs.handleRunUpdated(run as ExecutionRun);
    }
  });

  on("step.updated", (data) => {
    const payload = readPayload(data);
    const step = payload?.["step"];
    if (step) {
      runs.handleStepUpdated(step as ExecutionStep);
    }
  });

  on("attempt.updated", (data) => {
    const payload = readPayload(data);
    const attempt = payload?.["attempt"];
    if (attempt) {
      runs.handleAttemptUpdated(attempt as ExecutionAttempt);
    }
  });

  const handleWorkItemEvent = (data: unknown) => {
    const payload = readPayload(data);
    const item = payload?.["item"];
    if (item) {
      workboard.handleWorkItemUpsert(item as WorkItem);
    }
  };

  on("work.item.created", handleWorkItemEvent);
  on("work.item.updated", handleWorkItemEvent);
  on("work.item.blocked", handleWorkItemEvent);
  on("work.item.completed", handleWorkItemEvent);
  on("work.item.failed", handleWorkItemEvent);
  on("work.item.cancelled", handleWorkItemEvent);

  const handleWorkTaskEvent = (type: WorkTaskEvent["type"]) => (data: unknown) => {
    const payload = readPayload(data);
    if (!payload) return;
    const occurredAt = readOccurredAt(data) ?? readOccurredAt(payload) ?? new Date().toISOString();

    workboard.handleWorkTaskEvent({
      type,
      occurred_at: occurredAt,
      payload: payload as WorkTaskEvent["payload"],
    } as WorkTaskEvent);
  };

  on("work.task.leased", handleWorkTaskEvent("work.task.leased"));
  on("work.task.started", handleWorkTaskEvent("work.task.started"));
  on("work.task.paused", handleWorkTaskEvent("work.task.paused"));
  on("work.task.completed", handleWorkTaskEvent("work.task.completed"));
  registerActivityWsHandlers(ws, activity, unsubscribes);

  const dispose = (): void => {
    autoSync.dispose();
    activity.dispose();
    connection.store.disconnect();
    if (elevatedModeStoreOwned) {
      elevatedModeStore.dispose();
    }
    for (const unsub of unsubscribes) {
      unsub();
    }
    unsubscribes.length = 0;
  };

  return {
    wsUrl: options.wsUrl,
    httpBaseUrl: options.httpBaseUrl,
    deviceId: options.deviceIdentity?.deviceId ?? null,
    ws,
    http,
    elevatedModeStore,
    connectionStore: connection.store,
    autoSyncStore: autoSync.store,
    approvalsStore: approvals.store,
    pairingStore: pairing.store,
    statusStore: status.store,
    runsStore: runs.store,
    memoryStore: memory.store,
    workboardStore: workboard.store,
    agentStatusStore: agentStatus.store,
    chatStore: chat,
    activityStore: activity.store,
    syncAllNow: async () => {
      workboard.store.resetSupportProbe();
      await autoSync.syncAllNow();
    },
    connect() {
      connection.store.connect();
    },
    disconnect() {
      connection.store.disconnect();
    },
    dispose,
  };
}

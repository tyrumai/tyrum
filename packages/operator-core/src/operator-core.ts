import {
  TyrumClient,
  createTyrumHttpClient,
  type ExecutionAttempt,
  type ExecutionRun,
  type ExecutionStep,
  type TyrumClientEvents,
} from "@tyrum/client/browser";
import { httpAuthForAuth, wsTokenForAuth } from "./auth.js";
import type { OperatorHttpClient, OperatorWsClient } from "./deps.js";
import {
  createPrivilegedHttpClientFactory,
  createPrivilegedWsClientFactory,
} from "./operator-core.privileged-clients.js";
import type { OperatorCore, OperatorCoreOptions } from "./operator-core.types.js";
import type { Unsubscribe } from "./store.js";
import { createApprovalsStore } from "./stores/approvals-store.js";
import { createConnectionStore } from "./stores/connection-store.js";
import { createPairingStore, type Pairing } from "./stores/pairing-store.js";
import { createRunsStore } from "./stores/runs-store.js";
import { createElevatedModeStore } from "./stores/elevated-mode-store.js";
import { createStatusStore, type OperatorPresenceEntry } from "./stores/status-store.js";
import { createChatStore } from "./stores/chat-store.js";
import { createAutoSyncManager, type AutoSyncTask } from "./auto-sync.js";
import { createWorkboardStore } from "./stores/workboard-store.js";
import { createAgentStatusStore } from "./stores/agent-status-store.js";
import { createActivityStore } from "./stores/activity-store.js";
import {
  readClientId,
  readDisconnect,
  readPendingApprovalFromRequest,
  readReconnectSchedule,
  readTransportMessage,
} from "./operator-core.transport-helpers.js";
import { createDesktopEnvironmentHostsStore } from "./stores/desktop-environment-hosts-store.js";
import { createDesktopEnvironmentsStore } from "./stores/desktop-environments-store.js";
import { registerActivityWsHandlers } from "./operator-core.activity-events.js";
import { readOccurredAt, readPayload } from "./operator-core.event-helpers.js";
import type { Approval, WorkItem } from "@tyrum/schemas";
import type { WorkTaskEvent } from "./workboard/workboard-utils.js";
export type { OperatorCore, OperatorCoreOptions } from "./operator-core.types.js";

export function createOperatorCore(options: OperatorCoreOptions): OperatorCore {
  const elevatedModeStore = options.elevatedModeStore ?? createElevatedModeStore();
  const elevatedModeStoreOwned = options.elevatedModeStore === undefined;
  const createPrivilegedWs =
    options.deps?.createPrivilegedWs ??
    createPrivilegedWsClientFactory({
      wsUrl: options.wsUrl,
      deviceIdentity: options.deviceIdentity,
      elevatedModeStore,
    });

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
  const createPrivilegedHttp =
    options.deps?.createPrivilegedHttp ??
    createPrivilegedHttpClientFactory({ httpBaseUrl: options.httpBaseUrl, elevatedModeStore });

  const connection = createConnectionStore(ws);
  const approvals = createApprovalsStore({ ws, getPrivilegedWs: createPrivilegedWs });
  const pairing = createPairingStore({ http, getPrivilegedHttp: createPrivilegedHttp });
  const status = createStatusStore(http);
  const runs = createRunsStore(ws);
  const chat = createChatStore(ws, http);
  const workboard = createWorkboardStore(ws);
  const agentStatus = createAgentStatusStore(http);
  const desktopEnvironmentHosts = createDesktopEnvironmentHostsStore(http);
  const desktopEnvironments = createDesktopEnvironmentsStore(http);
  const activity = createActivityStore({
    runsStore: runs.store,
    approvalsStore: approvals.store,
    statusStore: status.store,
    chatStore: chat,
  });

  const warmStores = {
    approvalsStore: approvals.store,
    pairingStore: pairing.store,
    runsStore: runs.store,
    statusStore: status.store,
    workboardStore: workboard.store,
    agentStatusStore: agentStatus.store,
    desktopEnvironmentHostsStore: desktopEnvironmentHosts.store,
    desktopEnvironmentsStore: desktopEnvironments.store,
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
    runsStore: [
      {
        id: "runs.refreshRecent",
        run: async () => {
          await runs.store.refreshRecent({ limit: 100 });
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
    desktopEnvironmentHostsStore: [
      {
        id: "desktopEnvironmentHosts.refresh",
        run: async () => {
          await desktopEnvironmentHosts.store.refresh();
          const error = desktopEnvironmentHosts.store.getSnapshot().error;
          if (error) throw new Error(error);
        },
      },
    ],
    desktopEnvironmentsStore: [
      {
        id: "desktopEnvironments.refresh",
        run: async () => {
          await desktopEnvironments.store.refresh();
          const error = desktopEnvironments.store.getSnapshot().error;
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

  on("approval.updated" as never, (data) => {
    const payload = readPayload(data);
    const approval = payload?.["approval"];
    if (approval) {
      approvals.handleApprovalUpsert(approval as Approval);
    }
  });

  on("pairing.updated" as never, (data) => {
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
    workboardStore: workboard.store,
    agentStatusStore: agentStatus.store,
    desktopEnvironmentHostsStore: desktopEnvironmentHosts.store,
    desktopEnvironmentsStore: desktopEnvironments.store,
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

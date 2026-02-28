import {
  TyrumClient,
  createTyrumHttpClient,
  type Approval,
  type ClientCapability,
  type ExecutionAttempt,
  type ExecutionRun,
  type ExecutionStep,
  type MemoryItemId,
  type MemoryItem,
  type MemoryTombstone,
  type TyrumClientEvents,
} from "@tyrum/client";
import { httpAuthForAuth, wsTokenForAuth, type OperatorAuthStrategy } from "./auth.js";
import type { OperatorHttpClient, OperatorWsClient } from "./deps.js";
import type { Unsubscribe } from "./store.js";
import { createApprovalsStore, type ApprovalsStore } from "./stores/approvals-store.js";
import { createConnectionStore, type ConnectionStore } from "./stores/connection-store.js";
import { createPairingStore, type Pairing, type PairingStore } from "./stores/pairing-store.js";
import { createRunsStore, type RunsStore } from "./stores/runs-store.js";
import { createAdminModeStore, type AdminModeStore } from "./stores/admin-mode-store.js";
import {
  createStatusStore,
  type OperatorPresenceEntry,
  type StatusStore,
} from "./stores/status-store.js";
import { createMemoryStore, type MemoryStore } from "./stores/memory-store.js";

export interface OperatorCoreOptions {
  wsUrl: string;
  httpBaseUrl: string;
  auth: OperatorAuthStrategy;
  capabilities?: ClientCapability[];
  adminModeStore?: AdminModeStore;
  deps?: {
    ws?: OperatorWsClient;
    http?: Partial<OperatorHttpClient>;
  };
}

export interface OperatorCore {
  wsUrl: string;
  httpBaseUrl: string;
  ws: OperatorWsClient;
  http: OperatorHttpClient;
  adminModeStore: AdminModeStore;
  connectionStore: ConnectionStore;
  approvalsStore: ApprovalsStore;
  runsStore: RunsStore;
  pairingStore: PairingStore;
  statusStore: StatusStore;
  memoryStore: MemoryStore;
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

function readPayload(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const payload = (data as Record<string, unknown>)["payload"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

export function createOperatorCore(options: OperatorCoreOptions): OperatorCore {
  const adminModeStore = options.adminModeStore ?? createAdminModeStore();
  const adminModeStoreOwned = options.adminModeStore === undefined;

  const ws: OperatorWsClient =
    options.deps?.ws ??
    new TyrumClient({
      url: options.wsUrl,
      token: wsTokenForAuth(options.auth),
      capabilities: options.capabilities ?? [],
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

  const unsubscribes: Unsubscribe[] = [];
  const on = (event: keyof TyrumClientEvents, handler: (data: unknown) => void): void => {
    ws.on(event, handler);
    unsubscribes.push(() => {
      ws.off(event, handler);
    });
  };

  async function syncOnConnect(): Promise<void> {
    await Promise.allSettled([
      approvals.store.refreshPending(),
      pairing.store.refresh(),
      status.store.refreshStatus(),
      status.store.refreshPresence(),
      status.store.refreshUsage(),
    ]);
  }

  on("connected", (data) => {
    const clientId = readClientId(data);
    connection.handleConnected(clientId);
    void syncOnConnect();
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

  const dispose = (): void => {
    connection.store.disconnect();
    if (adminModeStoreOwned) {
      adminModeStore.dispose();
    }
    for (const unsub of unsubscribes) {
      unsub();
    }
    unsubscribes.length = 0;
  };

  return {
    wsUrl: options.wsUrl,
    httpBaseUrl: options.httpBaseUrl,
    ws,
    http,
    adminModeStore,
    connectionStore: connection.store,
    approvalsStore: approvals.store,
    pairingStore: pairing.store,
    statusStore: status.store,
    runsStore: runs.store,
    memoryStore: memory.store,
    connect() {
      connection.store.connect();
    },
    disconnect() {
      connection.store.disconnect();
    },
    dispose,
  };
}

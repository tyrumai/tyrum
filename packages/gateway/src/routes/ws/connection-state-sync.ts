import type { AuthTokenClaims, NodePairingRequest } from "@tyrum/contracts";
import { SANDBOX_CAPABILITY_ALLOWLIST } from "../../app/modules/desktop-environments/allowlist.js";
import type { DesktopEnvironmentDal } from "../../app/modules/desktop-environments/dal.js";
import { enrichPairingWithManagedDesktop } from "../../app/modules/desktop-environments/managed-desktop-reference.js";
import { isPairingBlockedStatus, type NodePairingDal } from "../../app/modules/node/pairing-dal.js";
import { DEFAULT_TENANT_ID } from "../../app/modules/identity/scope.js";
import type { PresenceDal } from "../../app/modules/presence/dal.js";
import {
  initializePairingReview,
  pairingStatusForReviewMode,
  resolveAutoReviewMode,
} from "../../app/modules/review/review-init.js";
import { broadcastWsEvent } from "../../ws/broadcast.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import { emitPairingApprovedEvent } from "../../ws/pairing-approved.js";
import type { ProtocolDeps } from "../../ws/protocol.js";
import { ensurePairingResolvedEvent } from "../../ws/stable-events.js";
import {
  PAIRING_REQUESTED_AUDIENCE,
  broadcastLocalEvent,
  createPresenceUpsertedEvent,
  type PendingInit,
} from "./connection-support.js";
import type { WsClusterOptions } from "./types.js";

export type ClientIpInfo = {
  rawRemoteIp: string | undefined;
  resolvedClientIp: string | undefined;
};

export interface ConnectionStateSyncDeps {
  connectionManager: ConnectionManager;
  protocolDeps: ProtocolDeps;
  cluster?: WsClusterOptions;
  connectionTtlMs: number;
  presenceDal?: PresenceDal;
  nodePairingDal?: NodePairingDal;
  desktopEnvironmentDal?: DesktopEnvironmentDal;
  presenceTtlMs: number;
}

export function syncConnectionEstablished(input: {
  deps: ConnectionStateSyncDeps;
  pending: PendingInit;
  claims: AuthTokenClaims | undefined;
  clientId: string;
  deviceId: string;
  clientIp: ClientIpInfo;
}): void {
  persistClusterConnection(input);
  upsertPresenceOnConnect(input);
  upsertNodePairingOnConnect(input);
}

export function syncConnectionClosed(input: {
  deps: ConnectionStateSyncDeps;
  connectionId: string;
  tenantId: string | null | undefined;
  deviceId: string | undefined;
}): void {
  removeClusterConnection(input);
  markPresenceDisconnected(input);
}

function persistClusterConnection(input: {
  deps: ConnectionStateSyncDeps;
  pending: PendingInit;
  claims: AuthTokenClaims | undefined;
  clientId: string;
  deviceId: string;
}): void {
  if (!input.deps.cluster) return;

  const nowMs = Date.now();
  void input.deps.cluster.connectionDirectory
    .upsertConnection({
      tenantId: input.claims?.tenant_id ?? undefined,
      connectionId: input.clientId,
      edgeId: input.deps.cluster.instanceId,
      role: input.pending.role,
      protocolRev: input.pending.protocolRev,
      deviceId: input.deviceId,
      pubkey: input.pending.pubkey,
      label: input.pending.label ?? null,
      version: input.pending.version ?? null,
      mode: input.pending.mode ?? null,
      deviceType: input.pending.deviceType ?? null,
      devicePlatform: input.pending.devicePlatform ?? null,
      deviceModel: input.pending.deviceModel ?? null,
      capabilities: input.pending.capabilities,
      nowMs,
      ttlMs: input.deps.connectionTtlMs,
    })
    .catch(() => {});
}

function upsertPresenceOnConnect(input: {
  deps: ConnectionStateSyncDeps;
  pending: PendingInit;
  claims: AuthTokenClaims | undefined;
  clientId: string;
  deviceId: string;
  clientIp: ClientIpInfo;
}): void {
  if (!input.deps.presenceDal) return;

  const nowMs = Date.now();
  const tenantId = input.claims?.tenant_id?.trim() || DEFAULT_TENANT_ID;
  const persistedClientIp = toPersistedClientIp(input.clientIp);
  void input.deps.presenceDal
    .upsert({
      tenantId,
      instanceId: input.deviceId,
      role: input.pending.role,
      connectionId: input.clientId,
      host: input.pending.label ?? null,
      ip: persistedClientIp.ip,
      version: input.pending.version ?? null,
      mode: input.pending.mode ?? null,
      metadata: {
        capabilities: input.pending.capabilities,
        edge_id: input.deps.cluster?.instanceId ?? null,
        ...persistedClientIp.metadata,
      },
      nowMs,
      ttlMs: input.deps.presenceTtlMs,
    })
    .then((row) => {
      broadcastLocalEvent(input.deps.connectionManager, createPresenceUpsertedEvent(row), tenantId);
    })
    .catch(() => {});
}

function upsertNodePairingOnConnect(input: {
  deps: ConnectionStateSyncDeps;
  pending: PendingInit;
  claims: AuthTokenClaims | undefined;
  clientIp: ClientIpInfo;
}): void {
  const nodePairingDal = input.deps.nodePairingDal;
  if (!nodePairingDal || input.pending.role !== "node") return;

  const tenantId = input.claims?.tenant_id?.trim();
  if (!tenantId) return;

  const nowIso = new Date().toISOString();
  const nodeId = input.pending.deviceId;
  const persistedClientIp = toPersistedClientIp(input.clientIp);
  void initializePairingOnConnect({
    deps: input.deps,
    nodePairingDal,
    pending: input.pending,
    tenantId,
    nodeId,
    persistedClientIp,
    nowIso,
  });
}

async function initializePairingOnConnect(input: {
  deps: ConnectionStateSyncDeps;
  nodePairingDal: NodePairingDal;
  pending: PendingInit;
  tenantId: string;
  nodeId: string;
  persistedClientIp: ReturnType<typeof toPersistedClientIp>;
  nowIso: string;
}): Promise<void> {
  try {
    const [previous, mode] = await Promise.all([
      input.nodePairingDal.getByNodeId(input.nodeId, input.tenantId),
      resolveAutoReviewMode({
        policyService: input.deps.protocolDeps.policyService,
        tenantId: input.tenantId,
      }),
    ]);
    const pairing = await input.nodePairingDal.upsertOnConnect({
      tenantId: input.tenantId,
      nodeId: input.nodeId,
      pubkey: input.pending.pubkey,
      label: input.pending.label ?? null,
      capabilities: input.pending.capabilities,
      initialStatus: pairingStatusForReviewMode(mode),
      metadata: {
        ip: input.persistedClientIp.ip,
        ...input.persistedClientIp.metadata,
        platform: input.pending.platform ?? null,
        version: input.pending.version ?? null,
        mode: input.pending.mode ?? null,
        device_type: input.pending.deviceType ?? null,
        device_platform: input.pending.devicePlatform ?? null,
        device_model: input.pending.deviceModel ?? null,
        edge_id: input.deps.cluster?.instanceId ?? null,
      },
      nowIso: input.nowIso,
    });
    const initializedPairing = await initializePairingReview({
      nodePairingDal: input.nodePairingDal,
      tenantId: input.tenantId,
      pairing,
    });

    // If this node belongs to a gateway-managed desktop environment, auto-approve
    // immediately to prevent the guardian review processor from claiming it.
    if (input.deps.desktopEnvironmentDal && isPairingBlockedStatus(initializedPairing.status)) {
      const managedEnv = await input.deps.desktopEnvironmentDal.getByNodeId(
        input.nodeId,
        input.tenantId,
      );
      if (managedEnv) {
        const resolved = await input.nodePairingDal.resolve({
          tenantId: input.tenantId,
          pairingId: initializedPairing.pairing_id,
          decision: "approved",
          trustLevel: "local",
          capabilityAllowlist: SANDBOX_CAPABILITY_ALLOWLIST,
          reason: "gateway-managed desktop environment",
          resolvedBy: {
            kind: "desktop_environment_runtime",
            environment_id: managedEnv.environment_id,
          },
          allowedCurrentStatuses: ["queued", "reviewing", "awaiting_human"],
        });
        const enrichedResolvedPairing =
          resolved?.transitioned && resolved.scopedToken
            ? await enrichPairingWithManagedDesktop({
                environmentDal: input.deps.desktopEnvironmentDal,
                tenantId: input.tenantId,
                pairing: resolved.pairing,
              })
            : resolved?.pairing;
        if (resolved?.transitioned && resolved.scopedToken) {
          const pairingForApprovedEvent = enrichedResolvedPairing ?? resolved.pairing;
          emitPairingApprovedEvent(
            {
              connectionManager: input.deps.connectionManager,
              logger: input.deps.protocolDeps.logger,
              maxBufferedBytes: input.deps.protocolDeps.maxBufferedBytes,
              cluster: input.deps.protocolDeps.cluster,
            },
            input.tenantId,
            {
              pairing: pairingForApprovedEvent,
              nodeId: input.nodeId,
              scopedToken: resolved.scopedToken,
            },
          );
        }
        if (resolved?.pairing) {
          await broadcastPairingRequested({
            deps: input.deps,
            tenantId: input.tenantId,
            pairing: enrichedResolvedPairing ?? resolved.pairing,
          });
        }
        return;
      }
    }

    const shouldRequest =
      (initializedPairing.status === "queued" ||
        initializedPairing.status === "reviewing" ||
        initializedPairing.status === "awaiting_human") &&
      (!previous ||
        previous.status === "denied" ||
        previous.status === "revoked" ||
        previous.status === "approved");
    if (!shouldRequest) return;
    await broadcastPairingRequested({
      deps: input.deps,
      tenantId: input.tenantId,
      pairing: initializedPairing,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.deps.protocolDeps.logger?.warn("ws.pairing_init_failed", {
      tenant_id: input.tenantId,
      node_id: input.nodeId,
      error: message,
    });
  }
}

async function broadcastPairingRequested(input: {
  deps: ConnectionStateSyncDeps;
  tenantId: string;
  pairing: NodePairingRequest;
}): Promise<void> {
  const enrichedPairing = input.pairing.node.managed_desktop
    ? input.pairing
    : await enrichPairingWithManagedDesktop({
        environmentDal: input.deps.desktopEnvironmentDal,
        tenantId: input.tenantId,
        pairing: input.pairing,
      });
  const persisted = await ensurePairingResolvedEvent({
    tenantId: input.tenantId,
    pairing: enrichedPairing,
    wsEventDal: input.deps.protocolDeps.wsEventDal,
  });
  broadcastWsEvent(
    input.tenantId,
    persisted.event,
    {
      connectionManager: input.deps.connectionManager,
      cluster: input.deps.protocolDeps.cluster,
      logger: input.deps.protocolDeps.logger,
      maxBufferedBytes: input.deps.protocolDeps.maxBufferedBytes,
    },
    PAIRING_REQUESTED_AUDIENCE,
  );
}

function removeClusterConnection(input: {
  deps: ConnectionStateSyncDeps;
  connectionId: string;
  tenantId: string | null | undefined;
}): void {
  if (!input.deps.cluster || !input.tenantId) return;
  void input.deps.cluster.connectionDirectory
    .removeConnection({ tenantId: input.tenantId, connectionId: input.connectionId })
    .catch(() => {});
}

function markPresenceDisconnected(input: {
  deps: ConnectionStateSyncDeps;
  deviceId: string | undefined;
  tenantId: string | null | undefined;
}): void {
  if (!input.deps.presenceDal || !input.deviceId) return;
  const tenantId = input.tenantId?.trim() || DEFAULT_TENANT_ID;
  void input.deps.presenceDal
    .markDisconnected({
      tenantId,
      instanceId: input.deviceId,
      nowMs: Date.now(),
      ttlMs: input.deps.presenceTtlMs,
    })
    .catch(() => {});
}

function toPersistedClientIp(input: ClientIpInfo): {
  ip: string | null;
  metadata: {
    raw_remote_ip: string | null;
    resolved_client_ip: string | null;
  };
} {
  const ip = input.resolvedClientIp ?? input.rawRemoteIp ?? null;
  return {
    ip,
    metadata: {
      raw_remote_ip: input.rawRemoteIp ?? null,
      resolved_client_ip: ip,
    },
  };
}

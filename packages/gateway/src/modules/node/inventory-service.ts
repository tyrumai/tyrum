import {
  descriptorIdForClientCapability,
  type CapabilityKind,
  type NodeInventoryDispatch,
  type NodeInventoryEntry,
} from "@tyrum/schemas";
import type {
  ConnectionDirectoryDal,
  ConnectionDirectoryRow,
} from "../backplane/connection-directory.js";
import type { NodePairingDal } from "./pairing-dal.js";
import type { PresenceDal, PresenceRow } from "../presence/dal.js";
import type { ConnectionManager, ConnectedClient } from "../../ws/connection-manager.js";
import { SessionLaneNodeAttachmentDal } from "../agent/session-lane-node-attachment-dal.js";

const ACTION_CAPABILITIES = [
  { action: "Web", capability: "playwright" },
  { action: "Browser", capability: "browser" },
  { action: "Android", capability: "android" },
  { action: "Desktop", capability: "desktop" },
  { action: "CLI", capability: "cli" },
  { action: "Http", capability: "http" },
] as const satisfies ReadonlyArray<{ action: string; capability: CapabilityKind }>;

type InventoryNode = {
  nodeId: string;
  label?: string;
  mode?: string;
  version?: string;
  connected: boolean;
  capabilities: Set<CapabilityKind>;
  readyCapabilities: Set<CapabilityKind>;
  lastSeenAtMs?: number;
};

type NodeInventoryServiceDeps = {
  connectionManager: ConnectionManager;
  connectionDirectory?: ConnectionDirectoryDal;
  nodePairingDal?: NodePairingDal;
  presenceDal?: PresenceDal;
  attachmentDal?: SessionLaneNodeAttachmentDal;
};

function capabilitySet(values: readonly CapabilityKind[] | undefined): Set<CapabilityKind> {
  return new Set(values ?? []);
}

function readMetadataString(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function upsertNode(map: Map<string, InventoryNode>, next: InventoryNode): void {
  const existing = map.get(next.nodeId);
  if (!existing) {
    map.set(next.nodeId, next);
    return;
  }

  const merged = existing.lastSeenAtMs ?? 0;
  const incoming = next.lastSeenAtMs ?? 0;
  if (incoming >= merged) {
    existing.label = next.label ?? existing.label;
    existing.mode = next.mode ?? existing.mode;
    existing.version = next.version ?? existing.version;
    existing.lastSeenAtMs = next.lastSeenAtMs ?? existing.lastSeenAtMs;
  }
  existing.connected ||= next.connected;
  for (const capability of next.capabilities) existing.capabilities.add(capability);
  for (const capability of next.readyCapabilities) existing.readyCapabilities.add(capability);
}

function fromDirectoryRow(row: ConnectionDirectoryRow): InventoryNode | undefined {
  if (row.role !== "node" || !row.device_id) return undefined;
  return {
    nodeId: row.device_id,
    label: row.label ?? undefined,
    mode: row.mode ?? undefined,
    version: row.version ?? undefined,
    connected: true,
    capabilities: capabilitySet(row.capabilities),
    readyCapabilities: capabilitySet(row.ready_capabilities),
    lastSeenAtMs: row.last_seen_at_ms,
  };
}

function fromConnectedClient(client: ConnectedClient): InventoryNode | undefined {
  if (client.role !== "node" || !client.device_id) return undefined;
  return {
    nodeId: client.device_id,
    connected: true,
    capabilities: capabilitySet(client.capabilities),
    readyCapabilities: new Set(client.readyCapabilities),
    lastSeenAtMs: client.lastWsPongAt,
  };
}

export class NodeInventoryService {
  constructor(private readonly deps: NodeInventoryServiceDeps) {}

  async list(input: {
    tenantId: string;
    capability?: string;
    dispatchableOnly?: boolean;
    key?: string;
    lane?: string;
  }): Promise<{ key?: string; lane?: string; nodes: NodeInventoryEntry[] }> {
    const nowMs = Date.now();
    const nodesById = new Map<string, InventoryNode>();

    if (this.deps.connectionDirectory) {
      const rows = await this.deps.connectionDirectory.listNonExpired(input.tenantId, nowMs);
      for (const row of rows) {
        const node = fromDirectoryRow(row);
        if (node) upsertNode(nodesById, node);
      }
    } else {
      for (const client of this.deps.connectionManager.allClients()) {
        if (client.auth_claims?.tenant_id !== input.tenantId) continue;
        const node = fromConnectedClient(client);
        if (node) upsertNode(nodesById, node);
      }
    }

    const pairings = this.deps.nodePairingDal
      ? await this.deps.nodePairingDal.list({ tenantId: input.tenantId, limit: 500 })
      : [];
    for (const pairing of pairings) {
      upsertNode(nodesById, {
        nodeId: pairing.node.node_id,
        label: pairing.node.label,
        mode: readMetadataString(pairing.node.metadata, "mode"),
        version: readMetadataString(pairing.node.metadata, "version"),
        connected: false,
        capabilities: capabilitySet(pairing.node.capabilities),
        readyCapabilities: new Set(),
      });
    }

    const attachmentKey = input.key?.trim() || undefined;
    const attachmentLane =
      attachmentKey && input.lane?.trim() ? input.lane.trim() : attachmentKey ? "main" : undefined;
    const attachment =
      this.deps.attachmentDal && attachmentKey && attachmentLane
        ? await this.deps.attachmentDal.get({
            tenantId: input.tenantId,
            key: attachmentKey,
            lane: attachmentLane,
          })
        : undefined;

    const presenceRows = this.deps.presenceDal
      ? await this.deps.presenceDal.listNonExpired(nowMs)
      : [];
    const presenceByNodeId = new Map<string, PresenceRow>();
    for (const row of presenceRows) {
      if (row.role !== "node") continue;
      presenceByNodeId.set(row.instance_id, row);
    }

    const filteredCapability = input.capability?.trim() || undefined;
    const dispatchableOnly = input.dispatchableOnly === true;
    const entries: NodeInventoryEntry[] = [];

    for (const [nodeId, node] of nodesById) {
      const pairing = pairings.find((entry) => entry.node.node_id === nodeId);
      const allowlist = pairing?.capability_allowlist ?? [];
      const dispatches: NodeInventoryDispatch[] = [];

      for (const { action, capability } of ACTION_CAPABILITIES) {
        const descriptorId = descriptorIdForClientCapability(capability);
        if (filteredCapability && filteredCapability !== descriptorId) continue;
        if (
          !node.capabilities.has(capability) &&
          !allowlist.some((entry) => entry.id === descriptorId)
        ) {
          continue;
        }

        const ready = node.readyCapabilities.has(capability);
        const allowed =
          pairing?.status === "approved" && allowlist.some((entry) => entry.id === descriptorId);
        dispatches.push({
          capability: descriptorId,
          action,
          ready,
          allowed,
          dispatchable: node.connected && ready && allowed,
        });
      }

      if (dispatchableOnly && !dispatches.some((dispatch) => dispatch.dispatchable)) {
        continue;
      }

      const presence = presenceByNodeId.get(nodeId);
      const mode = node.mode ?? presence?.mode ?? undefined;
      const version = node.version ?? presence?.version ?? undefined;
      entries.push({
        node_id: nodeId,
        ...(node.label ? { label: node.label } : {}),
        ...(mode ? { mode } : {}),
        ...(version ? { version } : {}),
        connected: node.connected,
        paired_status: pairing?.status ?? null,
        attached_to_requested_lane: attachment?.attached_node_id === nodeId,
        ...(attachment?.attached_node_id === nodeId
          ? { source_client_device_id: attachment.source_client_device_id ?? null }
          : {}),
        ...(presence?.last_seen_at_ms || node.lastSeenAtMs
          ? {
              last_seen_at: new Date(
                presence?.last_seen_at_ms ?? node.lastSeenAtMs ?? nowMs,
              ).toISOString(),
            }
          : {}),
        dispatches,
      });
    }

    entries.sort((a, b) => {
      if (a.attached_to_requested_lane !== b.attached_to_requested_lane) {
        return a.attached_to_requested_lane ? -1 : 1;
      }
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.node_id.localeCompare(b.node_id);
    });

    return {
      ...(attachmentKey ? { key: attachmentKey } : {}),
      ...(attachmentKey && attachmentLane ? { lane: attachmentLane } : {}),
      nodes: entries,
    };
  }
}

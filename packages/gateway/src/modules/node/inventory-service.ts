import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
  type CapabilityKind,
  type NodeCapabilityState,
  type NodeCapabilitySummary,
  type NodeInventoryEntry,
} from "@tyrum/schemas";
import type {
  ConnectionDirectoryDal,
  ConnectionDirectoryRow,
} from "../backplane/connection-directory.js";
import type { NodePairingDal } from "./pairing-dal.js";
import type { PresenceDal } from "../presence/dal.js";
import { readRecordString } from "../util/coerce.js";
import type { ConnectionManager, ConnectedClient } from "../../ws/connection-manager.js";
import { SessionLaneNodeAttachmentDal } from "../agent/session-lane-node-attachment-dal.js";
import { getCapabilityCatalogEntry } from "./capability-catalog.js";

const ACTION_CAPABILITIES = [
  { capability: "playwright" },
  { capability: "browser" },
  { capability: "ios" },
  { capability: "android" },
  { capability: "desktop" },
  { capability: "cli" },
  { capability: "http" },
] as const satisfies ReadonlyArray<{ capability: CapabilityKind }>;

type InventoryNode = {
  nodeId: string;
  label?: string;
  mode?: string;
  version?: string;
  connected: boolean;
  capabilities: Set<CapabilityKind>;
  readyCapabilities: Set<CapabilityKind>;
  capabilityStates: Map<string, NodeCapabilityState>;
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

function capabilityStateMap(
  values: readonly NodeCapabilityState[] | undefined,
): Map<string, NodeCapabilityState> {
  return new Map((values ?? []).map((state) => [state.capability.id, state] as const));
}

function upsertNode(map: Map<string, InventoryNode>, next: InventoryNode): void {
  const existing = map.get(next.nodeId);
  if (!existing) {
    map.set(next.nodeId, next);
    return;
  }

  existing.label = existing.label ?? next.label;
  existing.mode = existing.mode ?? next.mode;
  existing.version = existing.version ?? next.version;
  existing.lastSeenAtMs = Math.max(existing.lastSeenAtMs ?? 0, next.lastSeenAtMs ?? 0) || undefined;
  existing.connected ||= next.connected;
  for (const capability of next.capabilities) existing.capabilities.add(capability);
  for (const capability of next.readyCapabilities) existing.readyCapabilities.add(capability);
  for (const [capabilityId, state] of next.capabilityStates) {
    existing.capabilityStates.set(capabilityId, state);
  }
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
    capabilityStates: capabilityStateMap(row.capability_states),
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
    capabilityStates: new Map(client.capabilityStates),
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
      const lastSeenAtMs = Date.parse(pairing.node.last_seen_at);
      upsertNode(nodesById, {
        nodeId: pairing.node.node_id,
        label: pairing.node.label,
        mode: readRecordString(pairing.node.metadata, "mode"),
        version: readRecordString(pairing.node.metadata, "version"),
        connected: false,
        capabilities: capabilitySet(pairing.node.capabilities),
        readyCapabilities: new Set(),
        capabilityStates: new Map(),
        lastSeenAtMs: Number.isFinite(lastSeenAtMs) ? lastSeenAtMs : undefined,
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

    const filteredCapability = input.capability?.trim() || undefined;
    const dispatchableOnly = input.dispatchableOnly === true;
    const entries: NodeInventoryEntry[] = [];

    for (const [nodeId, node] of nodesById) {
      const pairing = pairings.find((entry) => entry.node.node_id === nodeId);
      const allowlist = pairing?.capability_allowlist ?? [];
      const summaries: NodeCapabilitySummary[] = [];

      for (const { capability } of ACTION_CAPABILITIES) {
        const descriptorId = descriptorIdForClientCapability(capability);
        if (filteredCapability && filteredCapability !== descriptorId) continue;
        if (
          !node.capabilities.has(capability) &&
          !allowlist.some((entry) => entry.id === descriptorId)
        ) {
          continue;
        }

        const catalog = getCapabilityCatalogEntry(descriptorId);
        const state = node.capabilityStates.get(descriptorId);
        const ready = node.readyCapabilities.has(capability);
        const paired =
          pairing?.status === "approved" && allowlist.some((entry) => entry.id === descriptorId);
        let supportedActionCount = 0;
        let enabledActionCount = 0;
        let availableActionCount = 0;
        let unknownActionCount = 0;

        if (catalog) {
          const actionStates = new Map(
            (state?.actions ?? []).map((action) => [action.name, action] as const),
          );
          supportedActionCount = catalog.actions.length;

          for (const action of catalog.actions) {
            const currentState = actionStates.get(action.name);
            const enabled = currentState?.enabled ?? true;
            if (!enabled) continue;
            enabledActionCount += 1;
            if ((currentState?.availability_status ?? "unknown") === "available") {
              availableActionCount += 1;
            } else if ((currentState?.availability_status ?? "unknown") === "unknown") {
              unknownActionCount += 1;
            }
          }
        }

        summaries.push({
          capability: descriptorId,
          capability_version:
            state?.capability.version ??
            allowlist.find((entry) => entry.id === descriptorId)?.version ??
            CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          connected: node.connected,
          paired,
          dispatchable: catalog
            ? node.connected && ready && paired && enabledActionCount > 0
            : false,
          supported_action_count: supportedActionCount,
          enabled_action_count: enabledActionCount,
          available_action_count: availableActionCount,
          unknown_action_count: unknownActionCount,
        });
      }

      if (dispatchableOnly && !summaries.some((summary) => summary.dispatchable)) {
        continue;
      }

      entries.push({
        node_id: nodeId,
        ...(node.label ? { label: node.label } : {}),
        ...(node.mode ? { mode: node.mode } : {}),
        ...(node.version ? { version: node.version } : {}),
        connected: node.connected,
        paired_status: pairing?.status ?? null,
        attached_to_requested_lane: attachment?.attached_node_id === nodeId,
        ...(attachment?.attached_node_id === nodeId
          ? { source_client_device_id: attachment.source_client_device_id ?? null }
          : {}),
        ...(node.lastSeenAtMs ? { last_seen_at: new Date(node.lastSeenAtMs).toISOString() } : {}),
        capabilities: summaries,
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

import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  type CapabilityDescriptor,
  type DevicePlatform,
  type DeviceType,
  type NodeCapabilityState,
  type NodeCapabilitySummary,
  type NodeInventoryEntry,
  type NodePairingRequest,
  type NodePairingStatus,
} from "@tyrum/contracts";

type InventoryNode = {
  nodeId: string;
  label?: string;
  mode?: string;
  version?: string;
  deviceType?: DeviceType;
  devicePlatform?: DevicePlatform;
  deviceModel?: string;
  connected: boolean;
  capabilities: Map<string, CapabilityDescriptor>;
  readyCapabilities: Map<string, CapabilityDescriptor>;
  capabilityStates: Map<string, NodeCapabilityState>;
  lastSeenAtMs?: number;
};

export interface NodeInventoryConnectedClient {
  id: string;
  role: "client" | "node";
  device_id?: string;
  device_type?: DeviceType;
  device_platform?: DevicePlatform;
  device_model?: string;
  auth_claims?: {
    tenant_id?: string | null;
  };
  capabilities: readonly CapabilityDescriptor[];
  readyCapabilities: readonly CapabilityDescriptor[];
  capabilityStates: ReadonlyMap<string, NodeCapabilityState>;
  lastWsPongAt: number;
}

export interface NodeInventoryConnectionManagerPort {
  allClients(): Iterable<NodeInventoryConnectedClient>;
}

export interface NodeInventoryConnectionDirectoryRow {
  role: "client" | "node";
  connection_id: string;
  device_id: string | null;
  label: string | null;
  mode: string | null;
  version: string | null;
  device_type: DeviceType | null;
  device_platform: DevicePlatform | null;
  device_model: string | null;
  capabilities: readonly CapabilityDescriptor[];
  ready_capabilities: readonly CapabilityDescriptor[];
  capability_states: readonly NodeCapabilityState[];
  last_seen_at_ms: number;
}

export interface NodeInventoryConnectionDirectoryPort {
  listNonExpired(
    tenantId: string,
    nowMs: number,
  ): Promise<readonly NodeInventoryConnectionDirectoryRow[]>;
}

export interface NodeInventoryPairingPort {
  list(input: {
    tenantId: string;
    status?: NodePairingStatus;
    limit?: number;
  }): Promise<readonly NodePairingRequest[]>;
}

export interface NodeInventoryPresenceRow {
  role: "gateway" | "client" | "node";
  connection_id: string | null;
  last_input_seconds: number | null;
  last_seen_at_ms: number;
}

export interface NodeInventoryPresencePort {
  listNonExpired(nowMs: number, limit?: number): Promise<readonly NodeInventoryPresenceRow[]>;
}

export interface NodeInventoryAttachmentPort {
  get(input: { tenantId: string; key: string; lane: string }): Promise<
    | {
        source_client_device_id: string | null;
        attached_node_id: string | null;
      }
    | undefined
  >;
}

export interface NodeCapabilityCatalogEntry {
  descriptor: CapabilityDescriptor;
  actions: ReadonlyArray<{
    name: string;
    description: string;
  }>;
}

export interface NodeInventoryServiceDeps {
  connectionManager: NodeInventoryConnectionManagerPort;
  connectionDirectory?: NodeInventoryConnectionDirectoryPort;
  nodePairingDal?: NodeInventoryPairingPort;
  presenceDal?: NodeInventoryPresencePort;
  attachmentDal?: NodeInventoryAttachmentPort;
  capabilityCatalogEntries?: readonly NodeCapabilityCatalogEntry[];
}

function capabilityMap(
  values: readonly CapabilityDescriptor[] | undefined,
): Map<string, CapabilityDescriptor> {
  return new Map((values ?? []).map((capability) => [capability.id, capability] as const));
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
  existing.deviceType = existing.deviceType ?? next.deviceType;
  existing.devicePlatform = existing.devicePlatform ?? next.devicePlatform;
  existing.deviceModel = existing.deviceModel ?? next.deviceModel;
  existing.lastSeenAtMs = Math.max(existing.lastSeenAtMs ?? 0, next.lastSeenAtMs ?? 0) || undefined;
  existing.connected ||= next.connected;
  for (const [capabilityId, capability] of next.capabilities) {
    existing.capabilities.set(capabilityId, capability);
  }
  for (const [capabilityId, capability] of next.readyCapabilities) {
    existing.readyCapabilities.set(capabilityId, capability);
  }
  for (const [capabilityId, state] of next.capabilityStates) {
    existing.capabilityStates.set(capabilityId, state);
  }
}

function fromDirectoryRow(row: NodeInventoryConnectionDirectoryRow): InventoryNode | undefined {
  if (row.role !== "node" || !row.device_id) return undefined;
  return {
    nodeId: row.device_id,
    label: row.label ?? undefined,
    mode: row.mode ?? undefined,
    version: row.version ?? undefined,
    deviceType: row.device_type ?? undefined,
    devicePlatform: row.device_platform ?? undefined,
    deviceModel: row.device_model ?? undefined,
    connected: true,
    capabilities: capabilityMap(row.capabilities),
    readyCapabilities: capabilityMap(row.ready_capabilities),
    capabilityStates: capabilityStateMap(row.capability_states),
    lastSeenAtMs: row.last_seen_at_ms,
  };
}

function fromConnectedClient(client: NodeInventoryConnectedClient): InventoryNode | undefined {
  if (client.role !== "node" || !client.device_id) return undefined;
  return {
    nodeId: client.device_id,
    deviceType: client.device_type,
    devicePlatform: client.device_platform,
    deviceModel: client.device_model,
    connected: true,
    capabilities: capabilityMap(client.capabilities),
    readyCapabilities: capabilityMap(client.readyCapabilities),
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
    const nodeIdByConnectionId = new Map<string, string>();

    if (this.deps.connectionDirectory) {
      const rows = await this.deps.connectionDirectory.listNonExpired(input.tenantId, nowMs);
      for (const row of rows) {
        if (row.role === "node" && row.device_id) {
          nodeIdByConnectionId.set(row.connection_id, row.device_id);
        }
        const node = fromDirectoryRow(row);
        if (node) {
          upsertNode(nodesById, node);
        }
      }
    } else {
      for (const client of this.deps.connectionManager.allClients()) {
        if (client.auth_claims?.tenant_id !== input.tenantId) continue;
        if (client.role === "node" && client.device_id) {
          nodeIdByConnectionId.set(client.id, client.device_id);
        }
        const node = fromConnectedClient(client);
        if (node) {
          upsertNode(nodesById, node);
        }
      }
    }

    const pairings = this.deps.nodePairingDal
      ? await this.deps.nodePairingDal.list({ tenantId: input.tenantId, limit: 500 })
      : [];
    const pairingsByNodeId = new Map(
      pairings.map((pairing) => [pairing.node.node_id, pairing] as const),
    );

    for (const pairing of pairings) {
      const lastSeenAtMs = Date.parse(pairing.node.last_seen_at);
      upsertNode(nodesById, {
        nodeId: pairing.node.node_id,
        label: pairing.node.label,
        mode: readRecordString(pairing.node.metadata, "mode"),
        version: readRecordString(pairing.node.metadata, "version"),
        connected: false,
        capabilities: capabilityMap(pairing.node.capabilities),
        readyCapabilities: new Map(),
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

    const presenceByNodeId = new Map<string, { lastTyrumInteractionAt: string }>();
    if (this.deps.presenceDal) {
      const presenceEntries = await this.deps.presenceDal.listNonExpired(nowMs, 500);
      for (const entry of presenceEntries) {
        if (entry.role !== "node" || entry.last_input_seconds == null) continue;
        const interactionMs = entry.last_seen_at_ms - entry.last_input_seconds * 1000;
        if (interactionMs <= 0) continue;
        const nodeId = entry.connection_id
          ? nodeIdByConnectionId.get(entry.connection_id)
          : undefined;
        if (!nodeId) continue;
        presenceByNodeId.set(nodeId, {
          lastTyrumInteractionAt: new Date(interactionMs).toISOString(),
        });
      }
    }

    const filteredCapability = input.capability?.trim() || undefined;
    const dispatchableOnly = input.dispatchableOnly === true;
    const entries: NodeInventoryEntry[] = [];
    const catalogEntries = new Map(
      (this.deps.capabilityCatalogEntries ?? []).map(
        (entry) => [entry.descriptor.id, entry] as const,
      ),
    );

    for (const [nodeId, node] of nodesById) {
      const pairing = pairingsByNodeId.get(nodeId);
      const allowlist = pairing?.capability_allowlist ?? [];
      const summaries: NodeCapabilitySummary[] = [];
      const candidateDescriptorIds = [
        ...new Set([
          ...catalogEntries.keys(),
          ...node.capabilities.keys(),
          ...allowlist.map((entry) => entry.id),
        ]),
      ];

      for (const descriptorId of candidateDescriptorIds) {
        const advertisedCapability = node.capabilities.get(descriptorId);
        const pairedCapability = allowlist.find((entry) => entry.id === descriptorId);
        if (!advertisedCapability && !pairedCapability) {
          continue;
        }

        const catalog = catalogEntries.get(descriptorId);
        const state = node.capabilityStates.get(descriptorId);
        const ready = node.readyCapabilities.has(descriptorId);
        const paired = pairing?.status === "approved" && pairedCapability !== undefined;
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

        const catalogDescription = catalog?.actions[0]?.description;
        summaries.push({
          capability: descriptorId,
          capability_version:
            state?.capability.version ??
            node.readyCapabilities.get(descriptorId)?.version ??
            advertisedCapability?.version ??
            pairedCapability?.version ??
            CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          ...(catalogDescription ? { description: catalogDescription } : {}),
          connected: node.connected && advertisedCapability !== undefined,
          paired,
          dispatchable: node.connected && ready && paired && enabledActionCount > 0,
          supported_action_count: supportedActionCount,
          enabled_action_count: enabledActionCount,
          available_action_count: availableActionCount,
          unknown_action_count: unknownActionCount,
        });
      }

      if (
        filteredCapability &&
        !summaries.some((summary) => summary.capability === filteredCapability)
      ) {
        continue;
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
        device:
          node.deviceType || node.devicePlatform || node.deviceModel
            ? {
                ...(node.deviceType ? { type: node.deviceType } : {}),
                ...(node.devicePlatform ? { platform: node.devicePlatform } : {}),
                ...(node.deviceModel ? { model: node.deviceModel } : {}),
              }
            : undefined,
        last_tyrum_interaction_at: presenceByNodeId.get(nodeId)?.lastTyrumInteractionAt,
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

function readRecordString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

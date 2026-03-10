import {
  NodeCapabilityInspectionResponse,
  type NodeCapabilityActionDefinition,
  type NodeCapabilityInspectionResponse as NodeCapabilityInspectionResponseT,
} from "@tyrum/schemas";
import type { ConnectionDirectoryDal } from "../backplane/connection-directory.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { NodeInventoryService } from "./inventory-service.js";
import { getCapabilityCatalogEntry } from "./capability-catalog.js";

export class NodeCapabilityInspectionService {
  constructor(
    private readonly deps: {
      connectionManager: ConnectionManager;
      connectionDirectory?: ConnectionDirectoryDal;
      nodeInventoryService: NodeInventoryService;
    },
  ) {}

  async inspect(input: {
    tenantId: string;
    nodeId: string;
    capabilityId: string;
    includeDisabled?: boolean;
  }): Promise<NodeCapabilityInspectionResponseT> {
    const catalog = getCapabilityCatalogEntry(input.capabilityId);
    if (!catalog) {
      throw new Error(`action_not_supported: unsupported capability '${input.capabilityId}'`);
    }

    const inventory = await this.deps.nodeInventoryService.list({
      tenantId: input.tenantId,
      dispatchableOnly: false,
      capability: input.capabilityId,
    });
    const node = inventory.nodes.find((entry) => entry.node_id === input.nodeId);
    if (!node) {
      throw new Error(`unknown_node: ${input.nodeId}`);
    }

    const summary = node.capabilities.find((entry) => entry.capability === input.capabilityId);
    if (!summary) {
      throw new Error(`action_not_supported: capability '${input.capabilityId}' not available`);
    }

    const liveState = await this.resolveCapabilityState(
      input.tenantId,
      input.nodeId,
      input.capabilityId,
    );
    const actionStates = new Map((liveState?.actions ?? []).map((action) => [action.name, action]));
    const actions: NodeCapabilityActionDefinition[] = [];

    for (const action of catalog.actions) {
      const state = actionStates.get(action.name);
      const enabled = state?.enabled ?? true;
      if (!enabled && input.includeDisabled !== true) continue;
      actions.push({
        name: action.name,
        description: action.description,
        supported: true,
        enabled,
        availability_status: state?.availability_status ?? "unknown",
        ...(state?.unavailable_reason ? { unavailable_reason: state.unavailable_reason } : {}),
        input_schema: action.inputSchema,
        output_schema: action.outputSchema,
        consent: action.consent,
        permissions: action.permissions,
        transport: action.transport,
      });
    }

    const paired = summary.paired;
    return NodeCapabilityInspectionResponse.parse({
      status: "ok",
      generated_at: new Date().toISOString(),
      node_id: input.nodeId,
      capability: input.capabilityId,
      capability_version: liveState?.capability.version ?? summary.capability_version,
      connected: node.connected,
      paired,
      dispatchable: summary.dispatchable,
      source_of_truth: {
        schema: "gateway_catalog",
        state: "node_capability_state",
      },
      actions,
    });
  }

  private async resolveCapabilityState(tenantId: string, nodeId: string, capabilityId: string) {
    for (const client of this.deps.connectionManager.allClients()) {
      if (client.role !== "node") continue;
      if (client.auth_claims?.tenant_id !== tenantId) continue;
      if (client.device_id !== nodeId) continue;
      const state = client.capabilityStates.get(capabilityId);
      if (state) return state;
    }

    if (!this.deps.connectionDirectory) return undefined;
    const rows = await this.deps.connectionDirectory.listNonExpired(tenantId, Date.now());
    const row = rows.find((entry) => entry.role === "node" && entry.device_id === nodeId);
    return row?.capability_states.find((state) => state.capability.id === capabilityId);
  }
}

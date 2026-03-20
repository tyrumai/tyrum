import {
  isLegacyCapabilityDescriptorId,
  isLegacyUmbrellaCapabilityDescriptorId,
  NodeActionDispatchRequest,
  NodeInventoryResponse,
  type NodeActionDispatchRequest as NodeActionDispatchRequestT,
  type NodeActionDispatchResponse as NodeActionDispatchResponseT,
} from "@tyrum/contracts";
import type { NodeDispatchService, NodeInventoryService } from "@tyrum/runtime-node-control";
import type { ArtifactStore } from "../artifact/store.js";
import type { NodeCapabilityInspectionService } from "../node/capability-inspection-service.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { ConnectionDirectoryDal } from "../backplane/connection-directory.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import type { ToolResult, WorkspaceLeaseConfig } from "./tool-executor-shared.js";
import { getDedicatedDesktopToolDefinition } from "./tool-desktop-definitions.js";
import {
  stripNodeInspectionControlState,
  stripNodeListControlState,
} from "./tool-executor-node-dispatch-internals.js";
import {
  executeNodeDispatchRequest,
  legacyCapabilityError,
  legacyNamespacedCapabilityError,
  type DispatchExecutionContext,
  type NodeDispatchAudit,
} from "./tool-executor-node-dispatch-execute.js";
import {
  dispatchError,
  normalizeValidationFailure,
  normalizeJsonObject,
  preflightFailure,
  serializeToolDispatchResponse,
} from "./tool-executor-node-dispatch-helpers.js";

type NodeToolContext = {
  workspaceLease?: WorkspaceLeaseConfig;
  nodeDispatchService?: NodeDispatchService;
  nodeInventoryService?: NodeInventoryService;
  inspectionService?: NodeCapabilityInspectionService;
  connectionManager?: ConnectionManager;
  connectionDirectory?: ConnectionDirectoryDal;
  artifactStore?: ArtifactStore;
};

export async function executeHttpNodeDispatch(
  context: DispatchExecutionContext,
  request: NodeActionDispatchRequestT,
): Promise<NodeActionDispatchResponseT> {
  return await executeNodeDispatchRequest(context, request);
}

export async function executeNodeInspectTool(
  context: NodeToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const tenantId = context.workspaceLease?.tenantId;
  if (!tenantId || !context.inspectionService) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "node capability inspection is not configured",
    };
  }

  const parsed = normalizeJsonObject(args);
  const nodeId = typeof parsed?.["node_id"] === "string" ? parsed["node_id"].trim() : "";
  const capability = typeof parsed?.["capability"] === "string" ? parsed["capability"].trim() : "";
  if (!nodeId) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "missing required argument: node_id",
    };
  }
  if (!capability) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "missing required argument: capability",
    };
  }
  if (isLegacyUmbrellaCapabilityDescriptorId(capability)) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: legacyCapabilityError(capability),
    };
  }
  if (isLegacyCapabilityDescriptorId(capability)) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: legacyNamespacedCapabilityError(capability),
    };
  }

  try {
    const payload = stripNodeInspectionControlState(
      await context.inspectionService.inspect({
        tenantId,
        nodeId,
        capabilityId: capability,
        includeDisabled: false,
      }),
    );
    const tagged = tagContent(JSON.stringify(payload), "tool");
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  } catch (error) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeNodeListTool(
  context: NodeToolContext,
  toolCallId: string,
  args: unknown,
  audit?: NodeDispatchAudit,
): Promise<ToolResult> {
  const parsed = normalizeJsonObject(args);
  const tenantId = context.workspaceLease?.tenantId;
  if (!tenantId || !context.nodeInventoryService) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "tenantId is required for node inventory",
    };
  }

  const capability =
    typeof parsed?.["capability"] === "string" ? parsed["capability"].trim() : undefined;
  const dispatchableOnly =
    typeof parsed?.["dispatchable_only"] === "boolean" ? parsed["dispatchable_only"] : true;
  const key =
    typeof parsed?.["key"] === "string" && parsed["key"].trim().length > 0
      ? parsed["key"].trim()
      : audit?.work_session_key?.trim() || undefined;
  const lane =
    typeof parsed?.["lane"] === "string" && parsed["lane"].trim().length > 0
      ? parsed["lane"].trim()
      : audit?.work_lane?.trim() || undefined;
  if (capability && isLegacyUmbrellaCapabilityDescriptorId(capability)) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: legacyCapabilityError(capability),
    };
  }
  if (capability && isLegacyCapabilityDescriptorId(capability)) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: legacyNamespacedCapabilityError(capability),
    };
  }

  const payload = stripNodeListControlState(
    NodeInventoryResponse.parse({
      generated_at: new Date().toISOString(),
      status: "ok",
      ...(await context.nodeInventoryService.list({
        tenantId,
        capability,
        dispatchableOnly,
        key,
        lane,
      })),
    }),
    { capability, dispatchableOnly, key, lane },
  );
  const tagged = tagContent(JSON.stringify(payload), "tool");
  return {
    tool_call_id: toolCallId,
    output: sanitizeForModel(tagged),
    provenance: tagged,
  };
}

export async function executeNodeDispatchTool(
  context: NodeToolContext,
  toolCallId: string,
  args: unknown,
  audit?: NodeDispatchAudit,
): Promise<ToolResult> {
  const tenantId = context.workspaceLease?.tenantId;
  if (!tenantId || !context.nodeDispatchService) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "node dispatch is not configured",
    };
  }
  if (!context.inspectionService) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "node capability inspection is not configured",
    };
  }

  let request: NodeActionDispatchRequestT;
  try {
    request = NodeActionDispatchRequest.parse(args);
  } catch (error) {
    const details = normalizeValidationFailure(error);
    return {
      tool_call_id: toolCallId,
      output: "",
      error: `invalid node dispatch request: ${details.message}`,
    };
  }
  if (isLegacyUmbrellaCapabilityDescriptorId(request.capability)) {
    const response = preflightFailure(
      request,
      dispatchError("invalid_input", legacyCapabilityError(request.capability)),
    );
    const tagged = tagContent(serializeToolDispatchResponse(response), "tool");
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  }
  if (isLegacyCapabilityDescriptorId(request.capability)) {
    const response = preflightFailure(
      request,
      dispatchError("invalid_input", legacyNamespacedCapabilityError(request.capability)),
    );
    const tagged = tagContent(serializeToolDispatchResponse(response), "tool");
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  }

  const response = await executeNodeDispatchRequest(
    {
      tenantId,
      nodeDispatchService: context.nodeDispatchService,
      inspectionService: context.inspectionService,
      connectionManager: context.connectionManager,
      connectionDirectory: context.connectionDirectory,
      artifactStore: context.artifactStore,
      workspaceLease: context.workspaceLease,
    },
    request,
    audit,
  );
  const tagged = tagContent(serializeToolDispatchResponse(response), "tool");
  return {
    tool_call_id: toolCallId,
    output: sanitizeForModel(tagged),
    provenance: tagged,
  };
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stripDedicatedRoutingFields(
  value: Record<string, unknown>,
  dispatchTimeoutArg: string,
): Record<string, unknown> {
  const cloned = { ...value };
  delete cloned["node_id"];
  delete cloned[dispatchTimeoutArg];
  return cloned;
}

async function resolveDedicatedDesktopNodeId(
  context: NodeToolContext,
  toolId: string,
  capabilityId: string,
  requestedNodeId: string | undefined,
  audit?: NodeDispatchAudit,
): Promise<
  | {
      nodeId: string;
    }
  | {
      error: string;
    }
> {
  if (requestedNodeId) {
    return { nodeId: requestedNodeId };
  }

  const tenantId = context.workspaceLease?.tenantId;
  if (!tenantId || !context.nodeInventoryService) {
    return { error: "node inventory is not configured" };
  }

  const inventory = await context.nodeInventoryService.list({
    tenantId,
    capability: capabilityId,
    dispatchableOnly: true,
    key: audit?.work_session_key,
    lane: audit?.work_lane,
  });
  const attachedEligible = inventory.nodes.filter((node) => node.attached_to_requested_lane);
  if (attachedEligible.length === 1) {
    return { nodeId: attachedEligible[0]!.node_id };
  }
  if (inventory.nodes.length === 1) {
    return { nodeId: inventory.nodes[0]!.node_id };
  }
  if (inventory.nodes.length === 0) {
    return {
      error: `no eligible node found for '${toolId}'; use tool.node.list or provide node_id`,
    };
  }
  return {
    error: `ambiguous node selection for '${toolId}'; provide node_id or attach exactly one eligible node to the current lane`,
  };
}

export async function executeDedicatedDesktopTool(
  context: NodeToolContext,
  toolId: string,
  toolCallId: string,
  args: unknown,
  audit?: NodeDispatchAudit,
): Promise<ToolResult | undefined> {
  const definition = getDedicatedDesktopToolDefinition(toolId);
  if (!definition) {
    return undefined;
  }

  const tenantId = context.workspaceLease?.tenantId;
  if (!tenantId || !context.nodeDispatchService) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "node dispatch is not configured",
    };
  }
  if (!context.inspectionService) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "node capability inspection is not configured",
    };
  }

  const parsed = normalizeJsonObject(args);
  if (!parsed) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: `invalid ${toolId} request: expected an object`,
    };
  }

  const requestedNodeId = readOptionalString(parsed["node_id"]);
  const selection = await resolveDedicatedDesktopNodeId(
    context,
    toolId,
    definition.capabilityId,
    requestedNodeId,
    audit,
  );
  if ("error" in selection) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: selection.error,
    };
  }

  const validation = definition.inputParser.safeParse(args);
  const timeoutMs = readOptionalNumber(parsed[definition.dispatchTimeoutArg]);
  if (!validation.success) {
    const response = preflightFailure(
      {
        node_id: selection.nodeId,
        capability: definition.capabilityId,
        action_name: definition.actionName,
        input: stripDedicatedRoutingFields(parsed, definition.dispatchTimeoutArg),
        ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
      },
      normalizeValidationFailure(validation.error),
    );
    const tagged = tagContent(serializeToolDispatchResponse(response), "tool");
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  }

  const validated = normalizeJsonObject(validation.data);
  if (!validated) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: `invalid ${toolId} request: expected an object`,
    };
  }
  const dispatchTimeoutMs = readOptionalNumber(validated[definition.dispatchTimeoutArg]);

  const response = await executeNodeDispatchRequest(
    {
      tenantId,
      nodeDispatchService: context.nodeDispatchService,
      inspectionService: context.inspectionService,
      connectionManager: context.connectionManager,
      connectionDirectory: context.connectionDirectory,
      artifactStore: context.artifactStore,
      workspaceLease: context.workspaceLease,
    },
    {
      node_id: selection.nodeId,
      capability: definition.capabilityId,
      action_name: definition.actionName,
      input: stripDedicatedRoutingFields(validated, definition.dispatchTimeoutArg),
      ...(dispatchTimeoutMs !== undefined ? { timeout_ms: dispatchTimeoutMs } : {}),
    },
    audit,
  );
  const tagged = tagContent(serializeToolDispatchResponse(response), "tool");
  return {
    tool_call_id: toolCallId,
    output: sanitizeForModel(tagged),
    provenance: tagged,
  };
}

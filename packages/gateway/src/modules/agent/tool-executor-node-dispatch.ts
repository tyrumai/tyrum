import {
  isLegacyCapabilityDescriptorId,
  isLegacyUmbrellaCapabilityDescriptorId,
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
import { resolveExecutionConversationKind } from "./tool-execution-conversation.js";
import type { ToolResult, WorkspaceLeaseConfig } from "./tool-executor-shared.js";
import { getDedicatedDesktopToolDefinition } from "./tool-desktop-definitions.js";
import { stripNodeListControlState } from "./tool-executor-node-dispatch-internals.js";
import {
  executeNodeDispatchRequest,
  legacyCapabilityError,
  legacyNamespacedCapabilityError,
  type DispatchExecutionContext,
  type NodeDispatchAudit,
} from "./tool-executor-node-dispatch-execute.js";
import {
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

function hasUnsupportedCapabilityWildcard(capability: string): boolean {
  return capability.includes("*") || capability.includes("?");
}

function normalizeCapabilityFilter(capability: string | undefined): {
  capability?: string;
  error?: string;
} {
  if (!capability) {
    return {};
  }
  if (isLegacyUmbrellaCapabilityDescriptorId(capability)) {
    return { error: legacyCapabilityError(capability) };
  }
  if (isLegacyCapabilityDescriptorId(capability)) {
    return { error: legacyNamespacedCapabilityError(capability) };
  }
  if (hasUnsupportedCapabilityWildcard(capability)) {
    return {
      error:
        "wildcard capability filters are not supported; omit capability to list all nodes or use an exact split capability descriptor",
    };
  }
  return { capability };
}

export async function executeHttpNodeDispatch(
  context: DispatchExecutionContext,
  request: NodeActionDispatchRequestT,
): Promise<NodeActionDispatchResponseT> {
  return await executeNodeDispatchRequest(context, request);
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

  const executionConversation = await resolveExecutionConversationKind({
    db: context.workspaceLease?.db,
    tenantId,
    audit,
  });
  const capability =
    typeof parsed?.["capability"] === "string" ? parsed["capability"].trim() : undefined;
  const dispatchableOnly =
    typeof parsed?.["dispatchable_only"] === "boolean" ? parsed["dispatchable_only"] : false;
  const key =
    typeof parsed?.["key"] === "string" && parsed["key"].trim().length > 0
      ? parsed["key"].trim()
      : executionConversation.conversationKey;
  const normalizedCapability = normalizeCapabilityFilter(capability);
  if (normalizedCapability.error) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: normalizedCapability.error,
    };
  }

  const payload = stripNodeListControlState(
    NodeInventoryResponse.parse({
      generated_at: new Date().toISOString(),
      status: "ok",
      ...(await context.nodeInventoryService.list({
        tenantId,
        capability: normalizedCapability.capability,
        dispatchableOnly,
        key,
      })),
    }),
    { capability: normalizedCapability.capability, dispatchableOnly, key },
  );
  const tagged = tagContent(JSON.stringify(payload), "tool");
  return {
    tool_call_id: toolCallId,
    output: sanitizeForModel(tagged),
    provenance: tagged,
  };
}

export async function executeNodeCapabilityGetTool(
  context: NodeToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = normalizeJsonObject(args);
  const tenantId = context.workspaceLease?.tenantId;
  if (!tenantId || !context.inspectionService) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "node capability inspection is not configured",
    };
  }

  const nodeId =
    typeof parsed?.["node_id"] === "string" && parsed["node_id"].trim().length > 0
      ? parsed["node_id"].trim()
      : undefined;
  const capabilityRaw =
    typeof parsed?.["capability"] === "string" ? parsed["capability"].trim() : undefined;
  const includeDisabled =
    typeof parsed?.["include_disabled"] === "boolean" ? parsed["include_disabled"] : false;

  if (!nodeId) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "node_id is required for tool.node.capability.get",
    };
  }

  const normalizedCapability = normalizeCapabilityFilter(capabilityRaw);
  if (!normalizedCapability.capability || normalizedCapability.error) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error:
        normalizedCapability.error ??
        "capability is required for tool.node.capability.get and must be an exact split capability descriptor",
    };
  }

  const payload = await context.inspectionService.inspect({
    tenantId,
    nodeId,
    capabilityId: normalizedCapability.capability,
    includeDisabled,
  });
  const tagged = tagContent(JSON.stringify(payload), "tool");
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

  const executionConversation = await resolveExecutionConversationKind({
    db: context.workspaceLease?.db,
    tenantId,
    audit,
  });
  const inventory = await context.nodeInventoryService.list({
    tenantId,
    capability: capabilityId,
    dispatchableOnly: true,
    key: executionConversation.conversationKey,
  });
  const attachedEligible = inventory.nodes.filter(
    (node) => node.attached_to_requested_conversation,
  );
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
    error: `ambiguous node selection for '${toolId}'; provide node_id or attach exactly one eligible node to the current conversation`,
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

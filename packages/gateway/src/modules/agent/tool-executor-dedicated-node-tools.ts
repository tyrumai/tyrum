import { z } from "zod";
import {
  NodeId,
  type NodeActionDispatchRequest as NodeActionDispatchRequestT,
} from "@tyrum/contracts";
import type { NodeDispatchService, NodeInventoryService } from "@tyrum/runtime-node-control";
import type { ArtifactStore } from "../artifact/store.js";
import type { NodeCapabilityInspectionService } from "../node/capability-inspection-service.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { ConnectionDirectoryDal } from "../backplane/connection-directory.js";
import { getDedicatedCapabilityTool } from "./dedicated-capability-tools.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import { resolveExecutionConversationKind } from "./tool-execution-conversation.js";
import type { ToolResult, WorkspaceLeaseConfig } from "./tool-executor-shared.js";
import {
  executeNodeDispatchRequest,
  type DispatchExecutionContext,
  type NodeDispatchAudit,
} from "./tool-executor-node-dispatch-execute.js";
import {
  normalizeJsonObject,
  normalizeValidationFailure,
  serializeToolDispatchResponse,
} from "./tool-executor-node-dispatch-helpers.js";

type DedicatedNodeToolContext = {
  workspaceLease?: WorkspaceLeaseConfig;
  nodeDispatchService?: NodeDispatchService;
  nodeInventoryService?: NodeInventoryService;
  inspectionService?: NodeCapabilityInspectionService;
  connectionManager?: ConnectionManager;
  connectionDirectory?: ConnectionDirectoryDal;
  artifactStore?: ArtifactStore;
};

const DispatchTimeoutMs = z.number().int().positive().max(600_000);

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    tool_call_id: toolCallId,
    output: "",
    error: message,
  };
}

function extractRoutingArgs(
  rawArgs: Record<string, unknown>,
  supportsDispatchTimeout: boolean,
): { requestedNodeId?: string; dispatchTimeoutMs?: number; actionInput: Record<string, unknown> } {
  const actionInput = { ...rawArgs };
  let requestedNodeId: string | undefined;
  let dispatchTimeoutMs: number | undefined;

  if ("node_id" in actionInput) {
    const parsedNodeId = NodeId.safeParse(actionInput["node_id"]);
    if (!parsedNodeId.success) {
      throw new Error("invalid routed tool request: node_id must be a valid node id");
    }
    requestedNodeId = parsedNodeId.data;
    delete actionInput["node_id"];
  }

  if (supportsDispatchTimeout && "timeout_ms" in actionInput) {
    const parsedTimeout = DispatchTimeoutMs.safeParse(actionInput["timeout_ms"]);
    if (!parsedTimeout.success) {
      throw new Error(
        "invalid routed tool request: timeout_ms must be a positive integer <= 600000",
      );
    }
    dispatchTimeoutMs = parsedTimeout.data;
    delete actionInput["timeout_ms"];
  }

  return { requestedNodeId, dispatchTimeoutMs, actionInput };
}

async function selectNodeId(
  context: DedicatedNodeToolContext,
  capabilityId: string,
  requestedNodeId: string | undefined,
  audit?: NodeDispatchAudit,
): Promise<string> {
  if (requestedNodeId) {
    return requestedNodeId;
  }
  if (!context.nodeInventoryService || !context.workspaceLease?.tenantId) {
    throw new Error("node inventory is not configured");
  }

  const executionConversation = await resolveExecutionConversationKind({
    db: context.workspaceLease.db,
    tenantId: context.workspaceLease.tenantId,
    audit,
  });
  const inventory = await context.nodeInventoryService.list({
    tenantId: context.workspaceLease.tenantId,
    capability: capabilityId,
    dispatchableOnly: true,
    key: executionConversation.conversationKey,
  });
  const attachedCandidates = inventory.nodes.filter(
    (node) => node.attached_to_requested_conversation,
  );
  if (attachedCandidates.length === 1) {
    return attachedCandidates[0]!.node_id;
  }
  if (inventory.nodes.length === 1) {
    return inventory.nodes[0]!.node_id;
  }
  if (inventory.nodes.length === 0) {
    throw new Error(`no eligible nodes available for capability '${capabilityId}'`);
  }
  throw new Error("ambiguous node selection; specify node_id");
}

export async function executeDedicatedNodeTool(
  context: DedicatedNodeToolContext,
  toolId: string,
  toolCallId: string,
  args: unknown,
  audit?: NodeDispatchAudit,
): Promise<ToolResult | undefined> {
  const tool = getDedicatedCapabilityTool(toolId);
  if (!tool) {
    return undefined;
  }
  const tenantId = context.workspaceLease?.tenantId;
  if (!tenantId || !context.nodeDispatchService) {
    return errorResult(toolCallId, "node dispatch is not configured");
  }
  if (!context.inspectionService) {
    return errorResult(toolCallId, "node capability inspection is not configured");
  }

  const rawArgs = normalizeJsonObject(args);
  if (!rawArgs) {
    return errorResult(toolCallId, "invalid routed tool request: expected an object");
  }

  let routingArgs: ReturnType<typeof extractRoutingArgs>;
  try {
    routingArgs = extractRoutingArgs(rawArgs, tool.supportsDispatchTimeout);
  } catch (error) {
    return errorResult(toolCallId, error instanceof Error ? error.message : String(error));
  }

  let nodeId: string;
  try {
    nodeId = await selectNodeId(context, tool.capabilityId, routingArgs.requestedNodeId, audit);
  } catch (error) {
    return errorResult(toolCallId, error instanceof Error ? error.message : String(error));
  }

  let actionInput: Record<string, unknown>;
  try {
    actionInput = tool.action.inputParser.parse(routingArgs.actionInput) as Record<string, unknown>;
  } catch (error) {
    const request: NodeActionDispatchRequestT = {
      node_id: nodeId,
      capability: tool.capabilityId,
      action_name: tool.action.name,
      input: routingArgs.actionInput,
      ...(routingArgs.dispatchTimeoutMs !== undefined
        ? { timeout_ms: routingArgs.dispatchTimeoutMs }
        : {}),
    };
    const response = {
      status: "ok" as const,
      task_id: "not-dispatched",
      node_id: request.node_id,
      capability: request.capability,
      action_name: request.action_name,
      ok: false,
      payload_source: "none" as const,
      payload: null,
      error: normalizeValidationFailure(error),
    };
    const tagged = tagContent(serializeToolDispatchResponse(response), "tool");
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  }

  const dispatchContext: DispatchExecutionContext = {
    tenantId,
    nodeDispatchService: context.nodeDispatchService,
    inspectionService: context.inspectionService,
    connectionManager: context.connectionManager,
    connectionDirectory: context.connectionDirectory,
    artifactStore: context.artifactStore,
    workspaceLease: context.workspaceLease,
  };

  const response = await executeNodeDispatchRequest(
    dispatchContext,
    {
      node_id: nodeId,
      capability: tool.capabilityId,
      action_name: tool.action.name,
      input: actionInput,
      ...(routingArgs.dispatchTimeoutMs !== undefined
        ? { timeout_ms: routingArgs.dispatchTimeoutMs }
        : {}),
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

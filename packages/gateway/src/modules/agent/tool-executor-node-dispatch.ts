import {
  isLegacyCapabilityDescriptorId,
  isLegacyUmbrellaCapabilityDescriptorId,
  LEGACY_ID_MIGRATION_MAP,
  NodeActionDispatchRequest,
  NodeActionDispatchResponse,
  NodeCapabilityInspectionResponse,
  NodeInventoryResponse,
  type ActionPrimitive,
  type ActionPrimitiveKind,
  type DevicePlatform,
  type NodeActionDispatchRequest as NodeActionDispatchRequestT,
  type NodeActionDispatchResponse as NodeActionDispatchResponseT,
  type NodeCapabilityInspectionResponse as NodeCapabilityInspectionResponseT,
} from "@tyrum/schemas";
import type { ArtifactStore } from "../artifact/store.js";
import type { NodeCapabilityInspectionService } from "../node/capability-inspection-service.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import { getCapabilityCatalogAction } from "../node/capability-catalog.js";
import type { NodeInventoryService } from "../node/inventory-service.js";
import type { NodeDispatchService } from "./node-dispatch-service.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import type { ToolResult, WorkspaceLeaseConfig } from "./tool-executor-shared.js";
import {
  ensureSyntheticExecutionScope,
  stripNodeInspectionControlState,
  stripNodeListControlState,
} from "./tool-executor-node-dispatch-internals.js";
import {
  dispatchError,
  normalizeValidationFailure,
  normalizeExecutionFailure,
  normalizeJsonObject,
  normalizeProviderError,
  preflightFailure,
  resolveTimeout,
  selectPayload,
  serializeToolDispatchResponse,
  shapeNodeDispatchEvidence,
} from "./tool-executor-node-dispatch-helpers.js";

type NodeToolContext = {
  workspaceLease?: WorkspaceLeaseConfig;
  nodeDispatchService?: NodeDispatchService;
  nodeInventoryService?: NodeInventoryService;
  inspectionService?: NodeCapabilityInspectionService;
  connectionManager?: ConnectionManager;
  artifactStore?: ArtifactStore;
};

type NodeDispatchAudit = {
  work_session_key?: string;
  work_lane?: string;
  execution_run_id?: string;
  execution_step_id?: string;
  policy_snapshot_id?: string;
};

type DispatchExecutionContext = {
  tenantId: string;
  nodeDispatchService: NodeDispatchService;
  inspectionService: NodeCapabilityInspectionService;
  connectionManager?: ConnectionManager;
  artifactStore?: ArtifactStore;
  workspaceLease?: WorkspaceLeaseConfig;
};

const DEVICE_PLATFORM_TO_PRIMITIVE_KIND: Record<DevicePlatform, ActionPrimitiveKind> = {
  ios: "IOS",
  android: "Android",
  web: "Browser",
  macos: "Browser",
  windows: "Browser",
  linux: "Browser",
};

/**
 * Resolves the `ActionPrimitiveKind` for a cross-platform capability by
 * looking up the target node's device platform from the connection manager.
 */
function resolvePrimitiveKindFromNode(
  context: DispatchExecutionContext,
  nodeId: string,
): ActionPrimitiveKind | undefined {
  if (!context.connectionManager) return undefined;
  for (const client of context.connectionManager.allClients()) {
    if (client.device_id === nodeId && client.device_platform) {
      return DEVICE_PLATFORM_TO_PRIMITIVE_KIND[client.device_platform];
    }
  }
  return undefined;
}

function legacyCapabilityError(capability: string): string {
  return `legacy umbrella capability '${capability}' is not supported; use an exact split capability descriptor`;
}

function legacyNamespacedCapabilityError(capability: string): string {
  const replacement = LEGACY_ID_MIGRATION_MAP[capability];
  const canonical =
    replacement === undefined
      ? "a canonical capability ID"
      : typeof replacement === "string"
        ? `'${replacement}'`
        : replacement.length === 1
          ? `'${replacement[0]}'`
          : `one of: ${replacement.map((id) => `'${id}'`).join(", ")}`;
  return `deprecated platform-namespaced capability '${capability}' is not supported; use ${canonical} instead`;
}

async function performNodeDispatch(
  context: DispatchExecutionContext,
  request: NodeActionDispatchRequestT,
  audit?: NodeDispatchAudit,
): Promise<NodeActionDispatchResponseT> {
  if (isLegacyUmbrellaCapabilityDescriptorId(request.capability)) {
    return preflightFailure(
      request,
      dispatchError("invalid_input", legacyCapabilityError(request.capability)),
    );
  }
  if (isLegacyCapabilityDescriptorId(request.capability)) {
    return preflightFailure(
      request,
      dispatchError("invalid_input", legacyNamespacedCapabilityError(request.capability)),
    );
  }

  let normalizedInspection: NodeCapabilityInspectionResponseT;
  try {
    const inspection = await context.inspectionService.inspect({
      tenantId: context.tenantId,
      nodeId: request.node_id,
      capabilityId: request.capability,
      includeDisabled: true,
    });
    normalizedInspection = NodeCapabilityInspectionResponse.parse(inspection);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("action_not_supported:")) {
      return preflightFailure(
        request,
        dispatchError("action_not_supported", message.slice("action_not_supported:".length).trim()),
      );
    }
    if (message.startsWith("unknown_node:")) {
      return preflightFailure(
        request,
        dispatchError("runtime_unavailable", message.slice("unknown_node:".length).trim()),
      );
    }
    return preflightFailure(request, dispatchError("execution_failed", message));
  }

  if (!normalizedInspection.paired) {
    return preflightFailure(
      request,
      dispatchError(
        "capability_not_paired",
        `capability '${request.capability}' is not paired for node '${request.node_id}'`,
      ),
    );
  }

  const actionDefinition = normalizedInspection.actions.find(
    (action) => action.name === request.action_name,
  );
  if (!actionDefinition) {
    return preflightFailure(
      request,
      dispatchError(
        "action_not_supported",
        `action '${request.action_name}' is not supported for capability '${request.capability}'`,
      ),
    );
  }
  if (!actionDefinition.enabled) {
    return preflightFailure(
      request,
      dispatchError(
        "disabled_by_operator",
        `action '${request.action_name}' is disabled by the operator for node '${request.node_id}'`,
      ),
    );
  }
  if (actionDefinition.availability_status === "unavailable") {
    return preflightFailure(
      request,
      dispatchError(
        "runtime_unavailable",
        actionDefinition.unavailable_reason ??
          `action '${request.action_name}' is unavailable at runtime`,
      ),
    );
  }

  const catalogAction = getCapabilityCatalogAction(request.capability, request.action_name);
  if (!catalogAction) {
    return preflightFailure(
      request,
      dispatchError(
        "action_not_supported",
        `action '${request.action_name}' is not defined in the gateway catalog`,
      ),
    );
  }

  let actionArgs: Record<string, unknown>;
  try {
    actionArgs = catalogAction.inputParser.parse({
      ...request.input,
      [catalogAction.transport.op_field]: catalogAction.transport.op_value,
    }) as Record<string, unknown>;
  } catch (error) {
    return preflightFailure(request, normalizeValidationFailure(error));
  }

  const timeoutMs = resolveTimeout(request.timeout_ms);
  const runId = audit?.execution_run_id?.trim() || crypto.randomUUID();
  const stepId = audit?.execution_step_id?.trim() || crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const hasExecutionScope = Boolean(
    audit?.execution_run_id?.trim() && audit?.execution_step_id?.trim(),
  );
  const hasDurableRunId = hasExecutionScope
    ? true
    : await ensureSyntheticExecutionScope(context, {
        nodeId: request.node_id,
        runId,
        stepId,
        attemptId,
        key: audit?.work_session_key,
        lane: audit?.work_lane,
      });
  let primitiveKind = catalogAction.transport.primitive_kind;
  if (primitiveKind === null) {
    // Cross-platform capability — resolve primitive kind from the target node's device platform.
    const resolved = resolvePrimitiveKindFromNode(context, request.node_id);
    if (!resolved) {
      return preflightFailure(
        request,
        dispatchError(
          "runtime_unavailable",
          `cannot determine device platform for node '${request.node_id}'; cross-platform capability '${request.capability}' requires device metadata to dispatch`,
        ),
      );
    }
    primitiveKind = resolved;
  }
  const primitive: ActionPrimitive = {
    type: primitiveKind,
    args: actionArgs,
  };

  try {
    const { taskId, result } = await context.nodeDispatchService.dispatchAndWait(
      primitive,
      { tenantId: context.tenantId, runId, stepId, attemptId },
      { timeoutMs, nodeId: request.node_id },
    );

    const evidence = await shapeNodeDispatchEvidence(
      context,
      primitive.type,
      result.evidence,
      result.result,
      { runId, stepId },
      audit?.policy_snapshot_id,
    );

    const selected = selectPayload(catalogAction.transport.result_channel, result.result, evidence);
    const normalizedError = result.ok ? null : normalizeProviderError(result.error);

    return NodeActionDispatchResponse.parse({
      status: "ok",
      task_id: taskId,
      ...(hasDurableRunId ? { run_id: runId } : {}),
      node_id: request.node_id,
      capability: request.capability,
      action_name: request.action_name,
      ok: result.ok,
      payload_source: selected.payload_source,
      payload: selected.payload,
      error: normalizedError,
    });
  } catch (error) {
    return NodeActionDispatchResponse.parse({
      status: "ok",
      task_id: "not-dispatched",
      ...(hasDurableRunId ? { run_id: runId } : {}),
      node_id: request.node_id,
      capability: request.capability,
      action_name: request.action_name,
      ok: false,
      payload_source: "none",
      payload: null,
      error: normalizeExecutionFailure(error),
    });
  }
}

export async function executeHttpNodeDispatch(
  context: DispatchExecutionContext,
  request: NodeActionDispatchRequestT,
): Promise<NodeActionDispatchResponseT> {
  return await performNodeDispatch(context, request);
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

  const response = await performNodeDispatch(
    {
      tenantId,
      nodeDispatchService: context.nodeDispatchService,
      inspectionService: context.inspectionService,
      connectionManager: context.connectionManager,
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

import {
  NodeActionDispatchRequest,
  NodeActionDispatchResponse,
  NodeCapabilityInspectionResponse,
  NodeInventoryResponse,
  type ActionPrimitive,
  type NodeActionDispatchRequest as NodeActionDispatchRequestT,
  type NodeActionDispatchResponse as NodeActionDispatchResponseT,
  type NodeCapabilityInspectionResponse as NodeCapabilityInspectionResponseT,
} from "@tyrum/schemas";
import type { ArtifactStore } from "../artifact/store.js";
import type { NodeCapabilityInspectionService } from "../node/capability-inspection-service.js";
import { getCapabilityCatalogAction } from "../node/capability-catalog.js";
import type { NodeInventoryService } from "../node/inventory-service.js";
import type { NodeDispatchService } from "./node-dispatch-service.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import type { ToolResult, WorkspaceLeaseConfig } from "./tool-executor-shared.js";
import {
  dispatchError,
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
  artifactStore?: ArtifactStore;
  workspaceLease?: WorkspaceLeaseConfig;
};

async function performNodeDispatch(
  context: DispatchExecutionContext,
  request: NodeActionDispatchRequestT,
  audit?: NodeDispatchAudit,
): Promise<NodeActionDispatchResponseT> {
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
    const message = error instanceof Error ? error.message : String(error);
    return preflightFailure(request, dispatchError("invalid_input", message));
  }

  const timeoutMs = resolveTimeout(request.timeout_ms);
  const runId = audit?.execution_run_id?.trim() || crypto.randomUUID();
  const stepId = audit?.execution_step_id?.trim() || crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const primitive: ActionPrimitive = {
    type: catalogAction.transport.primitive_kind,
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

  try {
    const payload = await context.inspectionService.inspect({
      tenantId,
      nodeId,
      capabilityId: capability,
      includeDisabled: false,
    });
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

  const payload = NodeInventoryResponse.parse({
    status: "ok",
    generated_at: new Date().toISOString(),
    ...(await context.nodeInventoryService.list({
      tenantId,
      capability,
      dispatchableOnly,
      key,
      lane,
    })),
  });

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
  if (!tenantId || !context.nodeDispatchService || !context.inspectionService) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "node dispatch is not configured",
    };
  }

  let request: NodeActionDispatchRequestT;
  try {
    request = NodeActionDispatchRequest.parse(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      tool_call_id: toolCallId,
      output: "",
      error: `invalid node dispatch request: ${message}`,
    };
  }

  const response = await performNodeDispatch(
    {
      tenantId,
      nodeDispatchService: context.nodeDispatchService,
      inspectionService: context.inspectionService,
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

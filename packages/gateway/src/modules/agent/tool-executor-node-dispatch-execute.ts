import {
  isLegacyCapabilityDescriptorId,
  isLegacyUmbrellaCapabilityDescriptorId,
  LEGACY_ID_MIGRATION_MAP,
  NodeActionDispatchResponse,
  NodeCapabilityInspectionResponse,
  type ActionPrimitive,
  type ActionPrimitiveKind,
  type NodeActionDispatchRequest as NodeActionDispatchRequestT,
  type NodeActionDispatchResponse as NodeActionDispatchResponseT,
  type NodeCapabilityInspectionResponse as NodeCapabilityInspectionResponseT,
  type NodeInventoryEntry as NodeInventoryEntryT,
} from "@tyrum/contracts";
import type { NodeDispatchService } from "@tyrum/runtime-node-control";
import type { ArtifactStore } from "../artifact/store.js";
import type { NodeCapabilityInspectionService } from "../node/capability-inspection-service.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { ConnectionDirectoryDal } from "../backplane/connection-directory.js";
import { getCapabilityCatalogAction } from "../node/capability-catalog.js";
import type { WorkspaceLeaseConfig } from "./tool-executor-shared.js";
import { ensureSyntheticExecutionScope } from "./tool-executor-node-dispatch-internals.js";
import {
  dispatchError,
  normalizeExecutionFailure,
  normalizeProviderError,
  normalizeValidationFailure,
  preflightFailure,
  resolveTimeout,
  selectPayload,
  shapeNodeDispatchEvidence,
} from "./tool-executor-node-dispatch-helpers.js";

export type NodeDispatchAudit = {
  work_session_key?: string;
  work_lane?: string;
  execution_run_id?: string;
  execution_step_id?: string;
  policy_snapshot_id?: string;
};

export type DispatchExecutionContext = {
  tenantId: string;
  nodeDispatchService: NodeDispatchService;
  inspectionService: NodeCapabilityInspectionService;
  connectionManager?: ConnectionManager;
  connectionDirectory?: ConnectionDirectoryDal;
  artifactStore?: ArtifactStore;
  workspaceLease?: WorkspaceLeaseConfig;
};

type DevicePlatform = NonNullable<NonNullable<NodeInventoryEntryT["device"]>["platform"]>;

const ACTION_PRIMITIVE_KIND_BY_PLATFORM = {
  ios: "IOS",
  android: "Android",
  web: "Browser",
  macos: "Browser",
  windows: "Browser",
  linux: "Browser",
} satisfies Record<DevicePlatform, ActionPrimitiveKind>;

function primitiveKindForPlatform(platform: DevicePlatform): ActionPrimitiveKind {
  return ACTION_PRIMITIVE_KIND_BY_PLATFORM[platform];
}

async function resolvePrimitiveKindFromNode(
  context: DispatchExecutionContext,
  nodeId: string,
): Promise<ActionPrimitiveKind | undefined> {
  if (context.connectionManager) {
    for (const client of context.connectionManager.allClients()) {
      if (client.device_id === nodeId && client.device_platform) {
        return primitiveKindForPlatform(client.device_platform);
      }
    }
  }
  if (context.connectionDirectory) {
    const nowMs = Date.now();
    const rows = await context.connectionDirectory.listNonExpired(context.tenantId, nowMs);
    for (const row of rows) {
      if (row.device_id === nodeId && row.device_platform) {
        return primitiveKindForPlatform(row.device_platform);
      }
    }
  }
  return undefined;
}

export function legacyCapabilityError(capability: string): string {
  return `legacy umbrella capability '${capability}' is not supported; use an exact split capability descriptor`;
}

export function legacyNamespacedCapabilityError(capability: string): string {
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

export async function executeNodeDispatchRequest(
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
        capabilityId: request.capability,
        runId,
        stepId,
        attemptId,
        key: audit?.work_session_key,
        lane: audit?.work_lane,
      });
  let primitiveKind = catalogAction.transport.primitive_kind;
  if (primitiveKind === null) {
    const resolved = await resolvePrimitiveKindFromNode(context, request.node_id);
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

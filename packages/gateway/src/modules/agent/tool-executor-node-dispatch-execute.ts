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
import { resolveWorkflowRunStepIdForExecutionStep } from "../execution/workflow-run-step-id.js";
import type { WorkspaceLeaseConfig } from "./tool-executor-shared.js";
import { resolveExecutionConversationKind } from "./tool-execution-conversation.js";
import { ensureSyntheticTurnScope } from "./tool-executor-node-dispatch-internals.js";
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
  work_conversation_key?: string;
  execution_turn_id?: string;
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

function adaptCrossPlatformActionArgs(
  capabilityId: string,
  primitiveKind: ActionPrimitiveKind,
  actionArgs: Record<string, unknown>,
): Record<string, unknown> {
  if (capabilityId !== "tyrum.camera.capture-photo") {
    return actionArgs;
  }

  if (primitiveKind !== "IOS" && primitiveKind !== "Android") {
    return actionArgs;
  }

  const { facing_mode, ...rest } = actionArgs;
  if (facing_mode === "user") {
    return { ...rest, camera: "front" };
  }
  if (facing_mode === "environment") {
    return { ...rest, camera: "rear" };
  }
  return rest;
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
  const executionConversation = await resolveExecutionConversationKind({
    db: context.workspaceLease?.db,
    tenantId: context.tenantId,
    audit,
  });
  const turnId = audit?.execution_turn_id?.trim() || crypto.randomUUID();
  const executionStepId = audit?.execution_step_id?.trim();
  const hasDurableTurnId = audit?.execution_turn_id?.trim()
    ? true
    : await ensureSyntheticTurnScope(context, {
        nodeId: request.node_id,
        capabilityId: request.capability,
        turnId,
        key: executionConversation.conversationKey,
      });
  const workflowRunStepId =
    executionStepId && context.workspaceLease?.db
      ? await resolveWorkflowRunStepIdForExecutionStep({
          db: context.workspaceLease.db,
          tenantId: context.tenantId,
          turnId,
          stepId: executionStepId,
        })
      : null;
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
    args: adaptCrossPlatformActionArgs(request.capability, primitiveKind, actionArgs),
  };

  let dispatched:
    | {
        taskId: string;
        dispatchId: string;
        result: Awaited<
          ReturnType<DispatchExecutionContext["nodeDispatchService"]["dispatchAndWait"]>
        >["result"];
      }
    | undefined;

  try {
    const dispatchScopeTurnId = hasDurableTurnId ? turnId : null;
    dispatched = await context.nodeDispatchService.dispatchAndWait(
      primitive,
      {
        tenantId: context.tenantId,
        turnId: dispatchScopeTurnId,
        workflowRunStepId,
      },
      { timeoutMs, nodeId: request.node_id },
    );
    const { taskId, dispatchId, result } = dispatched;

    const evidence = await shapeNodeDispatchEvidence(
      context,
      primitive.type,
      result.evidence,
      result.result,
      { tenantId: context.tenantId, turnId, stepId: executionStepId, dispatchId },
      audit?.policy_snapshot_id,
    );

    const selected = selectPayload(catalogAction.transport.result_channel, result.result, evidence);
    const normalizedError = result.ok ? null : normalizeProviderError(result.error);

    return NodeActionDispatchResponse.parse({
      status: "ok",
      task_id: taskId,
      dispatch_id: dispatchId,
      ...(hasDurableTurnId ? { turn_id: turnId } : {}),
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
      task_id: dispatched?.taskId ?? "not-dispatched",
      ...(dispatched?.dispatchId ? { dispatch_id: dispatched.dispatchId } : {}),
      ...(hasDurableTurnId ? { turn_id: turnId } : {}),
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

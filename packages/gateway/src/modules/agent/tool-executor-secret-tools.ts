import {
  SecretCopyToNodeClipboardArgs,
  type AgentSecretReference,
  type RoutedToolSelectionMode,
} from "@tyrum/contracts";
import type { NodeDispatchService, NodeInventoryService } from "@tyrum/runtime-node-control";
import type { ArtifactStore } from "../artifact/store.js";
import type { SecretProvider } from "../secret/provider.js";
import { createSecretHandleResolver } from "../secret/handle-resolver.js";
import type { NodeCapabilityInspectionService } from "../node/capability-inspection-service.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { ConnectionDirectoryDal } from "../backplane/connection-directory.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import type { ToolResult, WorkspaceLeaseConfig } from "./tool-executor-shared.js";
import {
  executeNodeDispatchRequest,
  type DispatchExecutionContext,
  type NodeDispatchAudit,
} from "./tool-executor-node-dispatch-execute.js";
import { normalizeValidationFailure } from "./tool-executor-node-dispatch-helpers.js";
import {
  resolveAllowedSecretReference,
  SECRET_CLIPBOARD_ACTION_NAME,
  SECRET_CLIPBOARD_CAPABILITY_ID,
  SECRET_CLIPBOARD_TOOL_ID,
} from "./tool-secret-definitions.js";

export type SecretToolContext = {
  workspaceLease?: WorkspaceLeaseConfig;
  nodeDispatchService?: NodeDispatchService;
  nodeInventoryService?: NodeInventoryService;
  inspectionService?: NodeCapabilityInspectionService;
  connectionManager?: ConnectionManager;
  connectionDirectory?: ConnectionDirectoryDal;
  artifactStore?: ArtifactStore;
  secretProvider?: SecretProvider;
  agentSecretRefs?: readonly AgentSecretReference[];
};

export type SecretToolExecutionResult = {
  result: ToolResult;
  secrets: string[];
};

type SelectedNode = {
  nodeId: string;
  selectionMode: RoutedToolSelectionMode;
};

function errorResult(toolCallId: string, message: string): SecretToolExecutionResult {
  return {
    result: {
      tool_call_id: toolCallId,
      output: "",
      error: message,
    },
    secrets: [],
  };
}

async function selectNode(
  context: SecretToolContext,
  requestedNodeId: string | undefined,
  audit?: NodeDispatchAudit,
): Promise<SelectedNode | { error: string }> {
  if (requestedNodeId) {
    return { nodeId: requestedNodeId, selectionMode: "explicit" };
  }

  const tenantId = context.workspaceLease?.tenantId;
  if (!tenantId || !context.nodeInventoryService) {
    return { error: "node inventory is not configured" };
  }

  const inventory = await context.nodeInventoryService.list({
    tenantId,
    capability: SECRET_CLIPBOARD_CAPABILITY_ID,
    dispatchableOnly: true,
    key: audit?.work_session_key,
    lane: audit?.work_lane,
  });

  if (inventory.nodes.length === 1) {
    return {
      nodeId: inventory.nodes[0]!.node_id,
      selectionMode: "sole_eligible_node",
    };
  }
  if (inventory.nodes.length === 0) {
    return {
      error: `no eligible clipboard-capable nodes available for '${SECRET_CLIPBOARD_TOOL_ID}'`,
    };
  }
  return {
    error:
      "ambiguous node selection for 'tool.secret.copy-to-node-clipboard'; provide node_id when multiple eligible clipboard-capable nodes exist",
  };
}

export async function executeSecretClipboardTool(
  context: SecretToolContext,
  toolId: string,
  toolCallId: string,
  args: unknown,
  audit?: NodeDispatchAudit,
): Promise<SecretToolExecutionResult | undefined> {
  if (toolId !== SECRET_CLIPBOARD_TOOL_ID) {
    return undefined;
  }
  if (!context.agentSecretRefs || context.agentSecretRefs.length === 0) {
    return undefined;
  }

  const parsedArgs = SecretCopyToNodeClipboardArgs.safeParse(args);
  if (!parsedArgs.success) {
    return errorResult(
      toolCallId,
      `invalid ${SECRET_CLIPBOARD_TOOL_ID} request: ${normalizeValidationFailure(parsedArgs.error).message}`,
    );
  }

  const tenantId = context.workspaceLease?.tenantId;
  if (!tenantId || !context.nodeDispatchService) {
    return errorResult(toolCallId, "node dispatch is not configured");
  }
  if (!context.inspectionService) {
    return errorResult(toolCallId, "node capability inspection is not configured");
  }
  if (!context.secretProvider) {
    return errorResult(toolCallId, "secret provider is not configured");
  }

  const selectedNode = await selectNode(context, parsedArgs.data.node_id, audit);
  if ("error" in selectedNode) {
    return errorResult(toolCallId, selectedNode.error);
  }

  const selector =
    "secret_alias" in parsedArgs.data && parsedArgs.data.secret_alias
      ? { secret_alias: parsedArgs.data.secret_alias }
      : { secret_ref_id: parsedArgs.data.secret_ref_id };

  const allowedSecretRef = resolveAllowedSecretReference(
    context.agentSecretRefs,
    SECRET_CLIPBOARD_TOOL_ID,
    selector,
  );
  if (!allowedSecretRef) {
    return errorResult(
      toolCallId,
      "secret_alias" in selector
        ? `secret alias '${selector.secret_alias}' is not allowed for '${SECRET_CLIPBOARD_TOOL_ID}'`
        : `secret_ref_id '${selector.secret_ref_id}' is not allowed for '${SECRET_CLIPBOARD_TOOL_ID}'`,
    );
  }

  const resolver = createSecretHandleResolver(context.secretProvider);
  const handle = await resolver.getById(allowedSecretRef.secret_ref_id);
  if (!handle) {
    return errorResult(
      toolCallId,
      `secret reference '${allowedSecretRef.secret_ref_id}' could not be resolved`,
    );
  }

  const plaintext = await context.secretProvider.resolve(handle);
  if (plaintext === null) {
    return errorResult(
      toolCallId,
      `secret reference '${allowedSecretRef.secret_ref_id}' could not be resolved`,
    );
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
      node_id: selectedNode.nodeId,
      capability: SECRET_CLIPBOARD_CAPABILITY_ID,
      action_name: SECRET_CLIPBOARD_ACTION_NAME,
      input: {
        text: plaintext,
      },
    },
    audit,
  );

  const safeResponse = {
    status: "ok" as const,
    tool_id: SECRET_CLIPBOARD_TOOL_ID,
    ok: response.ok,
    secret_ref_id: allowedSecretRef.secret_ref_id,
    ...(allowedSecretRef.secret_alias ? { secret_alias: allowedSecretRef.secret_alias } : {}),
    ...(allowedSecretRef.display_name ? { display_name: allowedSecretRef.display_name } : {}),
    selected_node_id: selectedNode.nodeId,
    selection_mode: selectedNode.selectionMode,
    ...(response.ok ? { result: { status: "ok" as const } } : { error: response.error }),
  };
  const tagged = tagContent(JSON.stringify(safeResponse), "tool");

  return {
    result: {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    },
    secrets: [plaintext],
  };
}

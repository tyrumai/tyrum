import {
  ActionPrimitiveKind,
  CapabilityDescriptor,
  descriptorIdForClientCapability,
  requiredCapability,
  type ActionPrimitive,
} from "@tyrum/schemas";
import {
  NoCapableNodeError,
  NodeDispatchDeniedError,
  NodeNotPairedError,
} from "../../ws/protocol/errors.js";
import type { ArtifactStore } from "../artifact/store.js";
import {
  resolveDesktopEvidenceSensitivity,
  shapeDesktopEvidenceForArtifacts,
} from "../desktop/shape-desktop-evidence.js";
import {
  resolveBrowserEvidenceSensitivity,
  shapeBrowserEvidenceForArtifacts,
} from "../browser/shape-browser-evidence.js";
import type { NodeDispatchService } from "./node-dispatch-service.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import {
  DEFAULT_NODE_DISPATCH_TIMEOUT_MS,
  MAX_NODE_DISPATCH_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  TRUNCATION_MARKER,
} from "./tool-executor-shared.js";
import type { ToolResult, WorkspaceLeaseConfig } from "./tool-executor-shared.js";

type NodeDispatchExecutorContext = {
  workspaceLease?: WorkspaceLeaseConfig;
  nodeDispatchService?: NodeDispatchService;
  artifactStore?: ArtifactStore;
};

type NodeDispatchAudit = {
  execution_run_id?: string;
  execution_step_id?: string;
  policy_snapshot_id?: string;
};

async function shapeNodeDispatchEvidence(
  context: NodeDispatchExecutorContext,
  actionKind: ActionPrimitive["type"],
  evidence: unknown,
  result: unknown,
  scope: { runId: string; stepId: string },
  policySnapshotId?: string,
): Promise<unknown> {
  if (actionKind !== "Desktop" && actionKind !== "Browser") return evidence;
  if (!context.artifactStore) return evidence;
  const lease = context.workspaceLease;
  const db = lease?.db;
  if (!db) return evidence;

  const fallbackScope = lease
    ? {
        tenantId: lease.tenantId,
        workspaceId: lease.workspaceId,
        agentId: lease.agentId,
        policySnapshotId: policySnapshotId?.trim() || null,
      }
    : undefined;

  if (actionKind === "Desktop") {
    const sensitivity = await resolveDesktopEvidenceSensitivity(db, scope);
    const shaped = await shapeDesktopEvidenceForArtifacts({
      db,
      artifactStore: context.artifactStore,
      runId: scope.runId,
      stepId: scope.stepId,
      workspaceId: lease?.workspaceId,
      fallbackScope,
      evidence,
      result,
      sensitivity,
    });
    return shaped.evidence;
  }

  const sensitivity = resolveBrowserEvidenceSensitivity();
  const shaped = await shapeBrowserEvidenceForArtifacts({
    db,
    artifactStore: context.artifactStore,
    runId: scope.runId,
    stepId: scope.stepId,
    workspaceId: lease?.workspaceId,
    fallbackScope,
    evidence,
    result,
    sensitivity,
  });
  return shaped.evidence;
}

export async function executeNodeDispatchTool(
  context: NodeDispatchExecutorContext,
  toolCallId: string,
  args: unknown,
  audit?: NodeDispatchAudit,
): Promise<ToolResult> {
  const parsed = args as Record<string, unknown> | null;
  const capability = typeof parsed?.["capability"] === "string" ? parsed["capability"].trim() : "";
  const actionToken = typeof parsed?.["action"] === "string" ? parsed["action"].trim() : "";

  if (!capability) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "missing required argument: capability",
    };
  }
  if (!actionToken) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "missing required argument: action",
    };
  }

  const parsedAction = ActionPrimitiveKind.safeParse(actionToken);
  if (!parsedAction.success) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: `invalid action: expected ActionPrimitiveKind (got '${actionToken}')`,
    };
  }

  const required = requiredCapability(parsedAction.data);
  if (!required) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: `unsupported action for node dispatch: '${parsedAction.data}'`,
    };
  }

  const capabilityId = CapabilityDescriptor.safeParse({ id: capability });
  if (!capabilityId.success) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: `invalid capability: ${capabilityId.error.message}`,
    };
  }

  const expectedCapability = descriptorIdForClientCapability(required);
  if (capabilityId.data.id !== expectedCapability) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: `capability '${capabilityId.data.id}' does not match action '${parsedAction.data}' (expected '${expectedCapability}')`,
    };
  }

  const argsRaw = parsed?.["args"];
  const actionArgs =
    argsRaw === undefined
      ? {}
      : argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)
        ? (argsRaw as Record<string, unknown>)
        : undefined;
  if (!actionArgs) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "invalid args: expected an object",
    };
  }

  const timeoutMsRaw = parsed?.["timeout_ms"];
  const timeoutMs =
    typeof timeoutMsRaw === "number"
      ? Math.max(1, Math.min(MAX_NODE_DISPATCH_TIMEOUT_MS, Math.floor(timeoutMsRaw)))
      : DEFAULT_NODE_DISPATCH_TIMEOUT_MS;

  const runId = audit?.execution_run_id?.trim() || crypto.randomUUID();
  const stepId = audit?.execution_step_id?.trim() || crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const action: ActionPrimitive = { type: parsedAction.data, args: actionArgs };

  let serializedPayload: string;
  try {
    const tenantId = context.workspaceLease?.tenantId;
    if (!tenantId || !context.nodeDispatchService) {
      throw new Error("tenantId is required for node dispatch");
    }

    const { taskId, result } = await context.nodeDispatchService.dispatchAndWait(
      action,
      { tenantId, runId, stepId, attemptId },
      { timeoutMs },
    );

    const evidence = await shapeNodeDispatchEvidence(
      context,
      parsedAction.data,
      result.evidence,
      result.result,
      { runId, stepId },
      audit?.policy_snapshot_id,
    );

    serializedPayload = JSON.stringify({
      ok: result.ok,
      task_id: taskId,
      evidence,
      error: result.error,
    });
    if (serializedPayload.length > MAX_RESPONSE_BYTES) {
      serializedPayload = JSON.stringify({
        ok: result.ok,
        task_id: taskId,
        error:
          typeof result.error === "string" && result.error.length > 4_096
            ? `${result.error.slice(0, 4_096)}${TRUNCATION_MARKER}`
            : result.error,
        evidence: "[omitted: evidence too large]",
        truncated: true,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let code = "dispatch_failed";
    let retryable = false;

    if (message.toLowerCase().includes("timeout")) {
      code = "timeout";
      retryable = true;
    } else if (err instanceof NoCapableNodeError) {
      code = "no_capable_node";
    } else if (err instanceof NodeDispatchDeniedError) {
      code = "policy_denied";
    } else if (err instanceof NodeNotPairedError) {
      code = "not_paired";
    }

    serializedPayload = JSON.stringify({
      ok: false,
      error: { code, message, retryable },
    });
  }

  const tagged = tagContent(serializedPayload, "tool");
  return {
    tool_call_id: toolCallId,
    output: sanitizeForModel(tagged),
    provenance: tagged,
  };
}

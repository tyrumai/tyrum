import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import { requireTenantIdValue } from "../identity/scope.js";
import type { PolicyService } from "../policy/service.js";
import type { SecretProvider } from "../secret/provider.js";
import type { StepExecutionContext, StepResult } from "./engine.js";
import { deriveAgentIdFromKey } from "./gateway-step-executor-types.js";
import { resolveSecretScopesFromArgs } from "./gateway-step-executor-helpers.js";
import { toolCallFromAction } from "./engine/tool-call.js";

export async function maybeEnforceLocalExecutorPolicy(input: {
  action: ActionPrimitiveT;
  context: StepExecutionContext;
  policyService?: PolicyService;
  secretProvider?: SecretProvider;
  isPolicyApprovalApproved?: (tenantId: string, approvalId: string) => Promise<boolean>;
}): Promise<StepResult | undefined> {
  const policy = input.policyService;
  if (!policy || !policy.isEnabled() || policy.isObserveOnly()) {
    return undefined;
  }

  if (input.action.type !== "CLI" && input.action.type !== "Http") {
    return undefined;
  }

  let tenantId: string;
  try {
    tenantId = requireTenantIdValue(input.context.tenantId, "missing/invalid tenant_id");
  } catch {
    return {
      success: false,
      failureKind: "policy",
      error: "missing/invalid tenant execution context",
    };
  }

  const policySnapshotId = input.context.policySnapshotId?.trim() ?? "";
  if (policySnapshotId.length === 0) {
    return {
      success: false,
      failureKind: "policy",
      error: "missing/invalid policy snapshot id for executor policy enforcement",
    };
  }

  const approvedPolicyGate =
    typeof input.context.approvalId === "string" && input.context.approvalId.trim().length > 0
      ? await input.isPolicyApprovalApproved?.(tenantId, input.context.approvalId.trim())
      : false;

  const secretScopes = await resolveSecretScopesFromArgs(
    input.action.args ?? {},
    input.secretProvider,
  );
  if (secretScopes.length > 0) {
    const secretsDecision = await policy.evaluateSecretsFromSnapshot({
      tenantId,
      policySnapshotId,
      secretScopes,
    });
    if (secretsDecision.decision === "deny") {
      return {
        success: false,
        failureKind: "policy",
        error: `policy denied secret resolution for scopes: ${secretScopes.join(", ")}`,
      };
    }
    if (secretsDecision.decision === "require_approval") {
      if (approvedPolicyGate) return undefined;
      return {
        success: true,
        pause: {
          kind: "policy",
          prompt: "Policy approval required — secret resolution",
          detail: `Step requires resolving ${String(secretScopes.length)} secret scope(s): ${secretScopes.join(", ")}`,
          context: {
            action_type: input.action.type,
            secret_scopes: secretScopes,
            policy_snapshot_id: policySnapshotId,
          },
        },
      };
    }
  }

  const tool = toolCallFromAction(input.action);
  const decision = await policy.evaluateToolCallFromSnapshot({
    tenantId,
    policySnapshotId,
    agentId: deriveAgentIdFromKey(input.context.key),
    workspaceId: input.context.workspaceId,
    toolId: tool.toolId,
    toolMatchTarget: tool.matchTarget,
    url: tool.url,
    secretScopes: secretScopes.length > 0 ? secretScopes : undefined,
    inputProvenance: { source: "workflow", trusted: true },
  });
  if (decision.decision === "deny") {
    return {
      success: false,
      failureKind: "policy",
      error: `policy denied ${tool.toolId}`,
    };
  }
  if (decision.decision === "require_approval") {
    if (approvedPolicyGate) return undefined;
    return {
      success: true,
      pause: {
        kind: "policy",
        prompt: "Policy approval required to continue execution",
        detail: `policy requires approval for '${tool.toolId}' (${tool.matchTarget || "unknown"})`,
        context: {
          source: "execution-engine",
          policy_snapshot_id: policySnapshotId,
          tool_id: tool.toolId,
          tool_match_target: tool.matchTarget,
          url: tool.url,
          decision: decision.decision,
        },
      },
    };
  }

  return undefined;
}

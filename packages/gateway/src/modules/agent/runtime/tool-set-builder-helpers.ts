import type { Decision, SecretHandle as SecretHandleT } from "@tyrum/schemas";
import type { ToolDescriptor } from "../tools.js";
import type { SuggestedOverride } from "../../policy/suggested-overrides.js";
import { coerceRecord } from "../../util/coerce.js";
import type { GatewayStateMode } from "../../runtime-state/mode.js";
import type { SecretProvider } from "../../secret/provider.js";
import type { ApprovalNotifier } from "../../approval/notifier.js";
import type { ApprovalDal, ApprovalStatus } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";

export interface ToolExecutionContext {
  tenantId: string;
  planId: string;
  sessionId: string;
  channel: string;
  threadId: string;
  execution?: { runId: string; stepIndex: number; stepId: string; stepApprovalId?: string };
}

export type ToolCallPolicyState = {
  toolDesc: ToolDescriptor;
  toolCallId: string;
  args: unknown;
  matchTarget: string;
  inputProvenance: { source: string; trusted: boolean };
  policyDecision?: Decision;
  policySnapshotId?: string;
  appliedOverrideIds?: string[];
  suggestedOverrides?: SuggestedOverride[];
  approvalStepIndex?: number;
  shouldRequireApproval: boolean;
};

export type ToolSetBuilderLogger = {
  info: (message: string, fields?: Record<string, unknown>) => void;
};

export type ToolSetBuilderRedactionEngine = { redactText: (text: string) => { redacted: string } };

export interface ToolSetBuilderDeps {
  home: string;
  stateMode?: GatewayStateMode;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  policyService: PolicyService;
  approvalDal: ApprovalDal;
  approvalNotifier: ApprovalNotifier;
  approvalWaitMs: number;
  approvalPollMs: number;
  logger: ToolSetBuilderLogger;
  secretProvider?: SecretProvider;
  plugins?: PluginRegistry;
  redactionEngine?: ToolSetBuilderRedactionEngine;
}

export function coerceSecretHandle(value: unknown): SecretHandleT | undefined {
  const record = coerceRecord(value);
  if (!record) return undefined;
  const handleId = typeof record["handle_id"] === "string" ? record["handle_id"].trim() : "";
  const provider = typeof record["provider"] === "string" ? record["provider"].trim() : "";
  const scope = typeof record["scope"] === "string" ? record["scope"].trim() : "";
  const createdAt = typeof record["created_at"] === "string" ? record["created_at"].trim() : "";
  if (!handleId || !provider || !scope || !createdAt) return undefined;
  if (provider !== "db") return undefined;
  return {
    handle_id: handleId,
    provider: "db",
    scope,
    created_at: createdAt,
  };
}

export function extractApprovalReason(
  approval: { resolution: unknown | null } | undefined,
): string | undefined {
  const record = coerceRecord(approval?.resolution);
  const reason = typeof record?.["reason"] === "string" ? record["reason"].trim() : "";
  return reason.length > 0 ? reason : undefined;
}

export function notApprovedJson(
  toolId: string,
  status: string,
  approvalId?: string,
  reason?: string,
): string {
  return JSON.stringify({
    error: `tool execution not approved for '${toolId}'`,
    ...(approvalId ? { approval_id: approvalId } : {}),
    status,
    ...(reason ? { reason } : {}),
  });
}

export type ApprovalDecisionResult = {
  approved: boolean;
  status: ApprovalStatus;
  approvalId: string;
  reason?: string;
};

export async function awaitApprovalForToolExecution(
  deps: Pick<
    ToolSetBuilderDeps,
    "tenantId" | "agentId" | "workspaceId" | "approvalDal" | "approvalNotifier" | "approvalWaitMs" | "approvalPollMs" | "logger"
  >,
  tool: ToolDescriptor,
  args: unknown,
  toolCallId: string,
  context: ToolExecutionContext,
  stepIndex: number,
  policyContext?: {
    policy_snapshot_id?: string;
    agent_id?: string;
    workspace_id?: string;
    suggested_overrides?: unknown;
    applied_override_ids?: string[];
  },
): Promise<ApprovalDecisionResult> {
  const deadline = Date.now() + deps.approvalWaitMs;
  const approvalKey = `${context.planId}:step:${String(stepIndex)}:tool_call:${toolCallId}`;
  const approval = await deps.approvalDal.create({
    tenantId: deps.tenantId,
    kind: "workflow_step",
    agentId: deps.agentId,
    workspaceId: deps.workspaceId,
    approvalKey,
    prompt: `Approve execution of '${tool.id}' (risk=${tool.risk})`,
    context: {
      source: "agent-tool-execution",
      tool_id: tool.id,
      tool_risk: tool.risk,
      tool_call_id: toolCallId,
      args,
      session_id: context.sessionId,
      channel: context.channel,
      thread_id: context.threadId,
      policy: policyContext ?? undefined,
    },
    expiresAt: new Date(deadline).toISOString(),
    sessionId: context.sessionId,
    runId: context.execution?.runId,
    stepId: context.execution?.stepId,
  });

  deps.logger.info("approval.created", {
    approval_id: approval.approval_id,
    plan_id: context.planId,
    step_index: stepIndex,
    tool_id: tool.id,
    tool_risk: tool.risk,
    tool_call_id: toolCallId,
    expires_at: approval.expires_at,
  });

  deps.approvalNotifier.notify(approval);

  while (Date.now() < deadline) {
    await deps.approvalDal.expireStale({ tenantId: deps.tenantId });
    const current = await deps.approvalDal.getById({
      tenantId: deps.tenantId,
      approvalId: approval.approval_id,
    });
    if (!current)
      return {
        approved: false,
        status: "expired",
        approvalId: approval.approval_id,
        reason: "approval record not found",
      };
    if (current.status === "approved")
      return {
        approved: true,
        status: "approved",
        approvalId: current.approval_id,
        reason: extractApprovalReason(current),
      };
    if (current.status === "denied" || current.status === "expired")
      return {
        approved: false,
        status: current.status,
        approvalId: current.approval_id,
        reason: extractApprovalReason(current),
      };

    const sleepMs = Math.min(deps.approvalPollMs, Math.max(1, deadline - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }

  const expired = await deps.approvalDal.expireById({
    tenantId: deps.tenantId,
    approvalId: approval.approval_id,
  });
  return {
    approved: false,
    status: "expired",
    approvalId: approval.approval_id,
    reason: extractApprovalReason(expired) ?? "approval timed out",
  };
}

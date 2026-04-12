import type { ModelMessage } from "ai";
import type { ToolDescriptor } from "../tools.js";
import { isBuiltinToolAvailableInStateMode, isToolAllowedWithDenylist } from "../tools.js";
import { collectSecretHandleIds } from "../../secret/collect-secret-handle-ids.js";
import { createSecretHandleResolver } from "../../secret/handle-resolver.js";
import { canonicalizeToolMatchTarget } from "../../policy/match-target.js";
import {
  suggestedOverridesForToolCall,
  toolIdsMatchForRollout,
  toolMatchTargetsMatchForRollout,
} from "@tyrum/runtime-policy";
import { hasToolResult } from "../../ai-sdk/message-utils.js";
import { coerceRecord } from "../../util/coerce.js";
import { ConversationQueueInterruptError } from "../../conversation-queue/queue-signal-dal.js";
import {
  resolveAllowedSecretReference,
  SECRET_CLIPBOARD_TOOL_ID,
} from "../tool-secret-definitions.js";
import type {
  ToolExecutionContext,
  ToolCallPolicyState,
  ToolSetBuilderDeps,
} from "./tool-set-builder-helpers.js";
import type { ConversationQueueState } from "./turn-engine-bridge.js";
import { coerceSecretHandle as coerceSecretHandleImpl } from "./tool-set-builder-helpers.js";

export interface ToolSetPolicyRuntime {
  syncConversationQueue(): Promise<"interrupt" | "steer" | undefined>;
  resolveResumedToolArgs(input: {
    toolId: string;
    toolCallId: string;
    args: unknown;
  }): Promise<unknown>;
  resolveToolCallPolicyState(input: {
    toolDesc: ToolDescriptor;
    toolCallId: string;
    args: unknown;
    inputProvenance: { source: string; trusted: boolean };
  }): Promise<ToolCallPolicyState>;
  canReuseResolvedApproval(input: {
    toolId: string;
    toolCallId: string;
    matchTarget: string;
    messages: ModelMessage[];
  }): Promise<boolean>;
  ensureApprovalStepIndex(input: { toolCallId: string; state: ToolCallPolicyState }): number;
}

export function createToolSetPolicyRuntime(input: {
  deps: ToolSetBuilderDeps;
  toolExecutionContext: ToolExecutionContext;
  queueState?: ConversationQueueState;
  toolCallPolicyStates?: Map<string, ToolCallPolicyState>;
}): ToolSetPolicyRuntime {
  let approvalStepIndex = 0;
  let currentAgentKeyPromise: Promise<string | undefined> | undefined;

  const resolveCurrentAgentKey = async (): Promise<string | undefined> => {
    if (!input.deps.identityScopeDal) {
      return undefined;
    }
    currentAgentKeyPromise ??= input.deps.identityScopeDal
      .resolveAgentKey(input.deps.tenantId, input.deps.agentId)
      .then((agentKey) => agentKey ?? undefined);
    return await currentAgentKeyPromise;
  };

  return {
    syncConversationQueue: async () => await syncConversationQueue(input.queueState),
    resolveResumedToolArgs: async (args) =>
      await resolveResumedToolArgs(input.deps, input.toolExecutionContext, args),
    resolveToolCallPolicyState: async (args) =>
      await resolveToolCallPolicyState({
        deps: input.deps,
        toolCallPolicyStates: input.toolCallPolicyStates,
        currentAgentKey: await resolveCurrentAgentKey(),
        ...args,
      }),
    canReuseResolvedApproval: async (args) =>
      await canReuseResolvedApproval(input.deps, input.toolExecutionContext, args),
    ensureApprovalStepIndex: ({ toolCallId, state }) => {
      if (state.approvalStepIndex === undefined) {
        state.approvalStepIndex = approvalStepIndex++;
        input.toolCallPolicyStates?.set(toolCallId, state);
      }
      return state.approvalStepIndex;
    },
  };
}

async function syncConversationQueue(
  queueState?: ConversationQueueState,
): Promise<"interrupt" | "steer" | undefined> {
  if (!queueState) return undefined;
  if (queueState.cancelToolCalls || queueState.interruptError) {
    return queueState.interruptError ? "interrupt" : "steer";
  }

  const signal = await queueState.signals.claimSignal({
    tenant_id: queueState.tenant_id,
    ...queueState.target,
  });
  if (signal?.kind === "interrupt") {
    queueState.interruptError ??= new ConversationQueueInterruptError();
    queueState.cancelToolCalls = true;
  }
  if (signal?.kind === "steer") {
    const text = signal.message_text.trim();
    if (text.length > 0) {
      queueState.pendingInjectionTexts.push(text);
    }
    queueState.cancelToolCalls = true;
  }

  return queueState.cancelToolCalls
    ? queueState.interruptError
      ? "interrupt"
      : "steer"
    : undefined;
}

async function resolveResumedToolArgs(
  deps: ToolSetBuilderDeps,
  context: ToolExecutionContext,
  input: {
    toolId: string;
    toolCallId: string;
    args: unknown;
  },
): Promise<unknown> {
  const execution = context.execution;
  if (!execution?.stepApprovalId || !deps.secretProvider) {
    return input.args;
  }

  const approval = await deps.approvalDal.getById({
    tenantId: deps.tenantId,
    approvalId: execution.stepApprovalId,
  });
  const ctx = coerceRecord(approval?.context);
  if (!ctx || ctx["source"] !== "agent-tool-execution") {
    return input.args;
  }
  if (
    !toolIdsMatchForRollout(ctx["tool_id"], input.toolId) ||
    ctx["tool_call_id"] !== input.toolCallId
  ) {
    return input.args;
  }

  const aiSdk = coerceRecord(ctx["ai_sdk"]);
  const handle = coerceSecretHandleImpl(aiSdk?.["tool_args_handle"]);
  if (!handle) return input.args;

  const raw = await deps.secretProvider.resolve(handle);
  if (!raw) return input.args;

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    void error;
    return input.args;
  }
}

async function resolveToolCallPolicyState(input: {
  deps: ToolSetBuilderDeps;
  toolCallPolicyStates?: Map<string, ToolCallPolicyState>;
  currentAgentKey?: string;
  toolDesc: ToolDescriptor;
  toolCallId: string;
  args: unknown;
  inputProvenance: { source: string; trusted: boolean };
}): Promise<ToolCallPolicyState> {
  const existing = input.toolCallPolicyStates?.get(input.toolCallId);
  if (existing && existing.toolDesc.id === input.toolDesc.id) {
    return existing;
  }

  const matchTarget = canonicalizeToolMatchTarget(
    input.toolDesc.id,
    input.args,
    input.deps.home,
    input.currentAgentKey,
  );
  const policy = input.deps.policyService;
  const roleAllowed = isRoleAllowedForTool(input.deps, input.toolDesc);

  let policyDecision: ToolCallPolicyState["policyDecision"];
  let policySnapshotId: string | undefined;
  let appliedOverrideIds: string[] | undefined;

  const evaluation = await policy.evaluateToolCall({
    tenantId: input.deps.tenantId,
    agentId: input.deps.agentId,
    workspaceId: input.deps.workspaceId,
    toolId: input.toolDesc.id,
    toolMatchTarget: matchTarget,
    url: resolveToolUrl(input.toolDesc.id, input.args),
    secretScopes: await resolveSecretScopes(input.deps, input.toolDesc.id, input.args),
    inputProvenance: input.inputProvenance,
    toolEffect: input.toolDesc.effect,
    roleAllowed,
  });
  policyDecision = evaluation.decision;
  policySnapshotId = evaluation.policy_snapshot?.policy_snapshot_id;
  appliedOverrideIds = evaluation.applied_override_ids;

  const state: ToolCallPolicyState = {
    toolDesc: input.toolDesc,
    toolCallId: input.toolCallId,
    args: input.args,
    matchTarget,
    inputProvenance: input.inputProvenance,
    policyDecision,
    policySnapshotId,
    appliedOverrideIds,
    suggestedOverrides: roleAllowed
      ? suggestedOverridesForToolCall({
          toolId: input.toolDesc.id,
          matchTarget,
          workspaceId: input.deps.workspaceId,
        })
      : undefined,
    approvalStepIndex: existing?.approvalStepIndex,
    shouldRequireApproval: !policy.isObserveOnly() && policyDecision === "require_approval",
  };

  input.toolCallPolicyStates?.set(input.toolCallId, state);
  return state;
}

function isRoleAllowedForTool(deps: ToolSetBuilderDeps, toolDesc: ToolDescriptor): boolean {
  const allowlist = deps.roleToolAllowlist;
  if (!allowlist) {
    return true;
  }
  if (
    (toolDesc.source === undefined || toolDesc.source === "builtin") &&
    deps.stateMode &&
    !isBuiltinToolAvailableInStateMode(toolDesc.id, deps.stateMode)
  ) {
    return false;
  }
  return isToolAllowedWithDenylist(allowlist, deps.roleToolDenylist, toolDesc.id);
}

function resolveToolUrl(toolId: string, args: unknown): string | undefined {
  if (toolId !== "webfetch" || !args || typeof args !== "object") {
    return undefined;
  }
  const url = (args as Record<string, unknown>)["url"];
  return typeof url === "string" ? url : undefined;
}

async function resolveSecretScopes(
  deps: ToolSetBuilderDeps,
  toolId: string,
  args: unknown,
): Promise<string[] | undefined> {
  const handleIds = collectSecretHandleIds(args);
  const argsRecord = coerceRecord(args);
  if (toolId === SECRET_CLIPBOARD_TOOL_ID && deps.secretRefs && argsRecord) {
    const secretAlias =
      typeof argsRecord["secret_alias"] === "string" ? argsRecord["secret_alias"] : undefined;
    const secretRefId =
      typeof argsRecord["secret_ref_id"] === "string" ? argsRecord["secret_ref_id"] : undefined;
    const selector = secretAlias
      ? { secret_alias: secretAlias }
      : secretRefId
        ? { secret_ref_id: secretRefId }
        : undefined;
    const allowedSecretRef = selector
      ? resolveAllowedSecretReference(deps.secretRefs, SECRET_CLIPBOARD_TOOL_ID, selector)
      : undefined;
    if (allowedSecretRef) {
      handleIds.push(allowedSecretRef.secret_ref_id);
    }
  }
  if (handleIds.length === 0 || !deps.secretProvider) {
    return undefined;
  }

  const secretScopes = await createSecretHandleResolver(deps.secretProvider).resolveScopes(
    handleIds,
  );
  return secretScopes.length > 0 ? secretScopes : undefined;
}

async function canReuseResolvedApproval(
  deps: ToolSetBuilderDeps,
  context: ToolExecutionContext,
  input: {
    toolId: string;
    toolCallId: string;
    matchTarget: string;
    messages: ModelMessage[];
  },
): Promise<boolean> {
  const stepApprovalId = context.execution?.stepApprovalId;
  if (!stepApprovalId) {
    return false;
  }

  const approval = await deps.approvalDal.getById({
    tenantId: deps.tenantId,
    approvalId: stepApprovalId,
  });
  if (
    !approval ||
    (approval.status !== "approved" &&
      approval.status !== "denied" &&
      approval.status !== "expired")
  ) {
    return false;
  }

  const ctx = coerceRecord(approval.context);
  const matches =
    ctx?.["source"] === "agent-tool-execution" &&
    toolIdsMatchForRollout(ctx["tool_id"], input.toolId) &&
    ctx["tool_call_id"] === input.toolCallId &&
    toolMatchTargetsMatchForRollout(ctx["tool_match_target"], input.matchTarget);

  return matches && !hasToolResult(input.messages, input.toolCallId);
}

import type { ModelMessage } from "ai";
import type { ToolDescriptor } from "../tools.js";
import { collectSecretHandleIds } from "../../secret/collect-secret-handle-ids.js";
import { canonicalizeToolMatchTarget } from "../../policy/match-target.js";
import { suggestedOverridesForToolCall } from "../../policy/suggested-overrides.js";
import { hasToolResult } from "../../ai-sdk/message-utils.js";
import { coerceRecord } from "../../util/coerce.js";
import { LaneQueueInterruptError } from "../../lanes/queue-signal-dal.js";
import type {
  ToolExecutionContext,
  ToolCallPolicyState,
  ToolSetBuilderDeps,
} from "./tool-set-builder-helpers.js";
import type { LaneQueueState } from "./turn-engine-bridge.js";
import { coerceSecretHandle as coerceSecretHandleImpl } from "./tool-set-builder-helpers.js";

export interface ToolSetPolicyRuntime {
  syncLaneQueue(): Promise<"interrupt" | "steer" | undefined>;
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
  laneQueue?: LaneQueueState;
  toolCallPolicyStates?: Map<string, ToolCallPolicyState>;
}): ToolSetPolicyRuntime {
  let approvalStepIndex = 0;

  return {
    syncLaneQueue: async () => await syncLaneQueue(input.laneQueue),
    resolveResumedToolArgs: async (args) =>
      await resolveResumedToolArgs(input.deps, input.toolExecutionContext, args),
    resolveToolCallPolicyState: async (args) =>
      await resolveToolCallPolicyState({
        deps: input.deps,
        toolCallPolicyStates: input.toolCallPolicyStates,
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

async function syncLaneQueue(
  laneQueue?: LaneQueueState,
): Promise<"interrupt" | "steer" | undefined> {
  if (!laneQueue) return undefined;
  if (laneQueue.cancelToolCalls || laneQueue.interruptError) {
    return laneQueue.interruptError ? "interrupt" : "steer";
  }

  const signal = await laneQueue.signals.claimSignal({
    tenant_id: laneQueue.tenant_id,
    ...laneQueue.scope,
  });
  if (signal?.kind === "interrupt") {
    laneQueue.interruptError ??= new LaneQueueInterruptError();
    laneQueue.cancelToolCalls = true;
  }
  if (signal?.kind === "steer") {
    const text = signal.message_text.trim();
    if (text.length > 0) {
      laneQueue.pendingInjectionTexts.push(text);
    }
    laneQueue.cancelToolCalls = true;
  }

  return laneQueue.cancelToolCalls ? (laneQueue.interruptError ? "interrupt" : "steer") : undefined;
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
  if (ctx["tool_id"] !== input.toolId || ctx["tool_call_id"] !== input.toolCallId) {
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
  toolDesc: ToolDescriptor;
  toolCallId: string;
  args: unknown;
  inputProvenance: { source: string; trusted: boolean };
}): Promise<ToolCallPolicyState> {
  const existing = input.toolCallPolicyStates?.get(input.toolCallId);
  if (existing && existing.toolDesc.id === input.toolDesc.id) {
    return existing;
  }

  const matchTarget = canonicalizeToolMatchTarget(input.toolDesc.id, input.args, input.deps.home);
  const policy = input.deps.policyService;
  const policyEnabled = policy.isEnabled();

  let policyDecision: ToolCallPolicyState["policyDecision"];
  let policySnapshotId: string | undefined;
  let appliedOverrideIds: string[] | undefined;

  if (policyEnabled) {
    const evaluation = await policy.evaluateToolCall({
      tenantId: input.deps.tenantId,
      agentId: input.deps.agentId,
      workspaceId: input.deps.workspaceId,
      toolId: input.toolDesc.id,
      toolMatchTarget: matchTarget,
      url: resolveToolUrl(input.toolDesc.id, input.args),
      secretScopes: await resolveSecretScopes(input.deps, input.args),
      inputProvenance: input.inputProvenance,
    });
    policyDecision = evaluation.decision;
    policySnapshotId = evaluation.policy_snapshot?.policy_snapshot_id;
    appliedOverrideIds = evaluation.applied_override_ids;
  }

  const state: ToolCallPolicyState = {
    toolDesc: input.toolDesc,
    toolCallId: input.toolCallId,
    args: input.args,
    matchTarget,
    inputProvenance: input.inputProvenance,
    policyDecision,
    policySnapshotId,
    appliedOverrideIds,
    suggestedOverrides: policyEnabled
      ? suggestedOverridesForToolCall({
          toolId: input.toolDesc.id,
          matchTarget,
          workspaceId: input.deps.workspaceId,
        })
      : undefined,
    approvalStepIndex: existing?.approvalStepIndex,
    shouldRequireApproval:
      policyEnabled && !policy.isObserveOnly()
        ? policyDecision === "require_approval"
        : input.toolDesc.requires_confirmation,
  };

  input.toolCallPolicyStates?.set(input.toolCallId, state);
  return state;
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
  args: unknown,
): Promise<string[] | undefined> {
  const handleIds = collectSecretHandleIds(args);
  if (handleIds.length === 0 || !deps.secretProvider) {
    return undefined;
  }

  const handles = await deps.secretProvider.list();
  const secretScopes = handleIds.map((id) => {
    const handle = handles.find((candidate) => candidate.handle_id === id);
    return handle?.scope ? `${handle.provider}:${handle.scope}` : id;
  });
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
    ctx["tool_id"] === input.toolId &&
    ctx["tool_call_id"] === input.toolCallId &&
    ctx["tool_match_target"] === input.matchTarget;

  return matches && !hasToolResult(input.messages, input.toolCallId);
}

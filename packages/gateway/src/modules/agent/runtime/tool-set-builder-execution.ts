import { randomUUID } from "node:crypto";
import { jsonSchema, tool as aiTool } from "ai";
import type { LanguageModel, ModelMessage, Tool, ToolExecutionOptions, ToolSet } from "ai";
import type { ToolDescriptor } from "../tools.js";
import { buildModelToolNameMap, registerModelTool } from "../tools.js";
import type { ToolExecutor, ToolResult } from "../tool-executor.js";
import { validateToolDescriptorInputSchema } from "../tool-schema.js";
import { tagContent } from "../provenance.js";
import { containsInjectionPatterns, sanitizeForModel } from "../sanitizer.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { AgentContextReport } from "./types.js";
import type { ConversationQueueState } from "./turn-engine-bridge.js";
import {
  awaitApprovalForToolExecution,
  extractApprovalReason,
  notApprovedJson,
  type ToolCallPolicyState,
  type ToolExecutionContext,
  type ToolSetBuilderDeps,
} from "./tool-set-builder-helpers.js";
import {
  maybeExtractWebFetchResult,
  recordToolResultContext,
  redactPluginToolResult,
  syncToolLifecycle,
} from "./tool-set-builder-lifecycle.js";
import {
  GUARDIAN_REVIEW_DECISION_TOOL_ID,
  createGuardianReviewDecisionTool,
} from "./tool-set-builder-internal-tools.js";
import { createToolSetPolicyRuntime } from "./tool-set-builder-policy.js";
import { type GuardianReviewDecisionCollector } from "../../review/guardian-review-mode.js";

type BuildRuntimeToolSetInput = {
  deps: ToolSetBuilderDeps;
  tools: readonly ToolDescriptor[];
  toolExecutor: ToolExecutor;
  usedTools: Set<string>;
  memoryWriteState?: { wrote: boolean };
  toolExecutionContext: ToolExecutionContext;
  contextReport: AgentContextReport;
  queueState?: ConversationQueueState;
  toolCallPolicyStates?: Map<string, ToolCallPolicyState>;
  model?: LanguageModel;
  guardianReviewDecisionCollector?: GuardianReviewDecisionCollector;
};

type ExecutionState = {
  drivingProvenance: { source: string; trusted: boolean };
};

type PluginExecutionResult = Awaited<ReturnType<PluginRegistry["executeTool"]>>;

export function buildRuntimeToolSet(input: BuildRuntimeToolSetInput): ToolSet {
  const result: Record<string, Tool> = {};
  const modelToolNames = buildModelToolNameMap(input.tools.map((tool) => tool.id));
  const executionState: ExecutionState = {
    drivingProvenance: { source: "user", trusted: true },
  };
  const policyRuntime = createToolSetPolicyRuntime({
    deps: input.deps,
    toolExecutionContext: input.toolExecutionContext,
    queueState: input.queueState,
    toolCallPolicyStates: input.toolCallPolicyStates,
  });

  for (const toolDesc of input.tools) {
    const validatedSchema = validateToolDescriptorInputSchema(toolDesc);
    if (!validatedSchema.ok) {
      throw new Error(`invalid input schema for tool '${toolDesc.id}': ${validatedSchema.error}`);
    }

    registerModelTool(
      result,
      toolDesc.id,
      createModelTool({
        ...input,
        toolDesc,
        inputSchema: validatedSchema.schema,
        policyRuntime,
        executionState,
      }),
      modelToolNames,
    );
  }

  if (input.guardianReviewDecisionCollector) {
    result[GUARDIAN_REVIEW_DECISION_TOOL_ID] = createGuardianReviewDecisionTool(
      input.guardianReviewDecisionCollector,
    );
  }
  return result;
}

function createModelTool(
  input: BuildRuntimeToolSetInput & {
    toolDesc: ToolDescriptor;
    inputSchema: Record<string, unknown>;
    policyRuntime: ReturnType<typeof createToolSetPolicyRuntime>;
    executionState: ExecutionState;
  },
): Tool {
  return aiTool({
    description: input.toolDesc.description,
    inputSchema: jsonSchema(input.inputSchema),
    needsApproval: input.toolExecutionContext.execution
      ? createNeedsApprovalHandler(input)
      : undefined,
    execute: createExecuteHandler(input),
  });
}

function createNeedsApprovalHandler(
  input: BuildRuntimeToolSetInput & {
    toolDesc: ToolDescriptor;
    policyRuntime: ReturnType<typeof createToolSetPolicyRuntime>;
    executionState: ExecutionState;
  },
):
  | ((args: unknown, options: { toolCallId: string; messages: ModelMessage[] }) => Promise<boolean>)
  | undefined {
  if (!input.toolExecutionContext.execution) {
    return undefined;
  }

  return async (args, options) => {
    if (await input.policyRuntime.syncConversationQueue()) {
      return false;
    }

    const effectiveArgs = await input.policyRuntime.resolveResumedToolArgs({
      toolId: input.toolDesc.id,
      toolCallId: options.toolCallId,
      args,
    });
    const state = await input.policyRuntime.resolveToolCallPolicyState({
      toolDesc: input.toolDesc,
      toolCallId: options.toolCallId,
      args: effectiveArgs,
      inputProvenance: { ...input.executionState.drivingProvenance },
    });
    if (!state.shouldRequireApproval) {
      return false;
    }
    if (
      await input.policyRuntime.canReuseResolvedApproval({
        toolId: input.toolDesc.id,
        toolCallId: options.toolCallId,
        matchTarget: state.matchTarget,
        messages: options.messages,
      })
    ) {
      return false;
    }

    input.policyRuntime.ensureApprovalStepIndex({ toolCallId: options.toolCallId, state });
    return true;
  };
}

function createExecuteHandler(
  input: BuildRuntimeToolSetInput & {
    toolDesc: ToolDescriptor;
    policyRuntime: ReturnType<typeof createToolSetPolicyRuntime>;
    executionState: ExecutionState;
  },
): (args: unknown, options: ToolExecutionOptions) => Promise<string> {
  return async (args, options) => {
    const cancelReason = await input.policyRuntime.syncConversationQueue();
    if (cancelReason) {
      return JSON.stringify({ error: "cancelled", reason: cancelReason });
    }

    const toolCallId = resolveToolCallId(options);
    const effectiveArgs = await input.policyRuntime.resolveResumedToolArgs({
      toolId: input.toolDesc.id,
      toolCallId,
      args,
    });
    const state = await input.policyRuntime.resolveToolCallPolicyState({
      toolDesc: input.toolDesc,
      toolCallId,
      args: effectiveArgs,
      inputProvenance: { ...input.executionState.drivingProvenance },
    });

    const approvalResponse = await maybeHandleToolApproval({
      deps: input.deps,
      policyRuntime: input.policyRuntime,
      toolDesc: input.toolDesc,
      toolCallId,
      args: effectiveArgs,
      state,
      context: input.toolExecutionContext,
    });
    if (approvalResponse) {
      return approvalResponse;
    }

    input.usedTools.add(input.toolDesc.id);
    await syncToolLifecycle(input.deps, {
      context: input.toolExecutionContext,
      toolCallId,
      toolId: input.toolDesc.id,
      status: "running",
      summary: "Running tool",
    });

    const startedAtMs = Date.now();
    const { pluginResult, result } = await executeToolInvocation({
      deps: input.deps,
      toolDesc: input.toolDesc,
      toolCallId,
      args: effectiveArgs,
      toolExecutor: input.toolExecutor,
      toolExecutionContext: input.toolExecutionContext,
      policySnapshotId: state.policySnapshotId,
    });
    const extractedResult = await maybeExtractWebFetchResult(
      { logger: input.deps.logger },
      {
        toolDesc: input.toolDesc,
        args: effectiveArgs,
        result,
        model: input.model,
        toolCallId,
      },
    );
    await syncToolLifecycle(input.deps, {
      context: input.toolExecutionContext,
      toolCallId,
      toolId: input.toolDesc.id,
      status: extractedResult.error ? "failed" : "completed",
      summary: extractedResult.error ? "Tool failed" : "Tool completed",
      error: extractedResult.error,
      durationMs: Math.max(0, Date.now() - startedAtMs),
    });

    const finalResult = redactPluginToolResult(input.deps, pluginResult, extractedResult);
    if (input.toolDesc.id === "mcp.memory.write" && !finalResult.error) {
      if (input.memoryWriteState) {
        input.memoryWriteState.wrote = true;
      }
    }
    updateDrivingProvenance(input.executionState, finalResult);

    const content = buildToolContent(finalResult);
    recordToolResultContext(input.contextReport, {
      toolCallId,
      toolId: input.toolDesc.id,
      content,
      result: finalResult,
    });
    return content;
  };
}

function resolveToolCallId(options: ToolExecutionOptions): string {
  return typeof options?.toolCallId === "string" && options.toolCallId.trim().length > 0
    ? options.toolCallId.trim()
    : `tc-${randomUUID()}`;
}

async function maybeHandleToolApproval(input: {
  deps: ToolSetBuilderDeps;
  policyRuntime: ReturnType<typeof createToolSetPolicyRuntime>;
  toolDesc: ToolDescriptor;
  toolCallId: string;
  args: unknown;
  state: ToolCallPolicyState;
  context: ToolExecutionContext;
}): Promise<string | undefined> {
  const policy = input.deps.policyService;
  if (input.state.policyDecision === "deny" && !policy.isObserveOnly()) {
    return JSON.stringify({
      error: `policy denied tool execution for '${input.toolDesc.id}'`,
      decision: "deny",
    });
  }
  if (!input.state.shouldRequireApproval) {
    return undefined;
  }

  const policyContext = {
    policy_snapshot_id: input.state.policySnapshotId,
    agent_id: input.deps.agentId,
    workspace_id: input.deps.workspaceId,
    suggested_overrides: input.state.suggestedOverrides,
    applied_override_ids: input.state.appliedOverrideIds,
  };
  const approvalStepIndex = input.policyRuntime.ensureApprovalStepIndex({
    toolCallId: input.toolCallId,
    state: input.state,
  });

  if (input.context.execution) {
    return await validateExistingExecutionApproval({
      deps: input.deps,
      toolDesc: input.toolDesc,
      toolCallId: input.toolCallId,
      matchTarget: input.state.matchTarget,
      stepApprovalId: input.context.execution.stepApprovalId,
    });
  }

  const decision = await awaitApprovalForToolExecution(
    input.deps,
    input.toolDesc,
    input.args,
    input.toolCallId,
    input.context,
    approvalStepIndex,
    policyContext,
    async (update) => {
      await syncToolLifecycle(input.deps, {
        context: input.context,
        toolCallId: input.toolCallId,
        toolId: input.toolDesc.id,
        status:
          update.status === "queued" ||
          update.status === "reviewing" ||
          update.status === "awaiting_human"
            ? "awaiting_approval"
            : update.status === "approved"
              ? "running"
              : "cancelled",
        summary:
          update.status === "queued" ||
          update.status === "reviewing" ||
          update.status === "awaiting_human"
            ? "Waiting for approval"
            : update.status === "approved"
              ? "Approval granted"
              : update.reason?.trim() || "Approval denied",
        error: update.status === "approved" || !update.reason?.trim() ? undefined : update.reason,
      });
    },
  );
  if (!decision.approved) {
    await syncToolLifecycle(input.deps, {
      context: input.context,
      toolCallId: input.toolCallId,
      toolId: input.toolDesc.id,
      status: "cancelled",
      summary: decision.reason?.trim() || "Tool execution denied",
      error: decision.reason,
    });
    return notApprovedJson(
      input.toolDesc.id,
      decision.status,
      decision.approvalId,
      decision.reason,
    );
  }

  return undefined;
}

async function validateExistingExecutionApproval(input: {
  deps: ToolSetBuilderDeps;
  toolDesc: ToolDescriptor;
  toolCallId: string;
  matchTarget: string;
  stepApprovalId?: string;
}): Promise<string | undefined> {
  if (!input.stepApprovalId) {
    return notApprovedJson(input.toolDesc.id, "awaiting_human");
  }

  const approval = await input.deps.approvalDal.getById({
    tenantId: input.deps.tenantId,
    approvalId: input.stepApprovalId,
  });
  const approved = approval?.status === "approved";
  const ctx =
    approval?.context && typeof approval.context === "object"
      ? (approval.context as Record<string, unknown>)
      : undefined;
  const matches =
    ctx?.["source"] === "agent-tool-execution" &&
    ctx["tool_id"] === input.toolDesc.id &&
    ctx["tool_call_id"] === input.toolCallId &&
    ctx["tool_match_target"] === input.matchTarget;

  return approved && matches
    ? undefined
    : notApprovedJson(
        input.toolDesc.id,
        approval?.status ?? "awaiting_human",
        input.stepApprovalId,
        extractApprovalReason(approval),
      );
}

async function executeToolInvocation(input: {
  deps: ToolSetBuilderDeps;
  toolDesc: ToolDescriptor;
  toolCallId: string;
  args: unknown;
  toolExecutor: ToolExecutor;
  toolExecutionContext: ToolExecutionContext;
  policySnapshotId?: string;
}): Promise<{ pluginResult: PluginExecutionResult; result: ToolResult }> {
  const pluginResult = await input.deps.plugins?.executeTool({
    toolId: input.toolDesc.id,
    toolCallId: input.toolCallId,
    args: input.args,
    home: input.deps.stateMode === "shared" ? "" : input.deps.home,
    agentId: input.deps.agentId,
    workspaceId: input.deps.workspaceId,
    auditPlanId: input.toolExecutionContext.planId,
    conversationId: input.toolExecutionContext.conversationId,
    channel: input.toolExecutionContext.channel,
    threadId: input.toolExecutionContext.threadId,
    policySnapshotId: input.policySnapshotId,
  });

  if (pluginResult) {
    const tagged = tagContent(pluginResult.output, "tool", false);
    return {
      pluginResult,
      result: {
        tool_call_id: input.toolCallId,
        output: sanitizeForModel(tagged),
        error: pluginResult.error,
        provenance: tagged,
      },
    };
  }

  return {
    pluginResult,
    result: await input.toolExecutor.execute(input.toolDesc.id, input.toolCallId, input.args, {
      agent_id: input.deps.agentId,
      workspace_id: input.deps.workspaceId,
      conversation_id: input.toolExecutionContext.conversationId,
      channel: input.toolExecutionContext.channel,
      thread_id: input.toolExecutionContext.threadId,
      work_conversation_key: input.toolExecutionContext.workConversationKey,
      execution_turn_id: input.toolExecutionContext.execution?.runId,
      execution_step_id: input.toolExecutionContext.execution?.stepId,
      policy_snapshot_id: input.policySnapshotId,
    }),
  };
}

function updateDrivingProvenance(state: ExecutionState, result: ToolResult): void {
  if (result.provenance) {
    state.drivingProvenance = {
      source: result.provenance.source,
      trusted: result.provenance.trusted,
    };
  }
}

function buildToolContent(result: ToolResult): string {
  let content = result.error ? JSON.stringify({ error: result.error }) : result.output;
  if (
    result.provenance &&
    !result.provenance.trusted &&
    containsInjectionPatterns(result.provenance.content)
  ) {
    content =
      "[SECURITY: This tool output contained potential prompt injection patterns that were neutralized.]\n" +
      content;
  }
  return content;
}

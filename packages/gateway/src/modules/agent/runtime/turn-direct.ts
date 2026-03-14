import { generateText, stepCountIs, streamText } from "ai";
import type { ModelMessage } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  WorkScope,
} from "@tyrum/schemas";
import {
  createStaticLanguageModelV3,
  extractToolApprovalResumeState,
  isStatusQuery,
} from "./turn-helpers.js";
import { isApprovalBlockedStatus } from "../../approval/dal.js";
import { coerceRecord } from "../../util/coerce.js";
import { finalizeTurn } from "./turn-finalization.js";
import type { AgentContextReport } from "./types.js";
import { resolveAutomationMetadata } from "./automation-delivery.js";
import {
  resolveIntakeDecision,
  delegateFromIntake,
  handleIntakeModeDecision,
} from "./intake-delegation.js";
import {
  compactForOverflow,
  createStopWhenWithWithinTurnLoopDetection,
  extractUsageSnapshot,
  makeEventfulAbortSignal,
  maybeAutoCompactSession,
  prepareLaneQueueStep,
  resolveTurnReply,
  type TurnDirectDeps,
} from "./turn-direct-runtime-helpers.js";
import {
  appendToolApprovalResponseMessage,
  countAssistantMessages,
} from "../../ai-sdk/message-utils.js";
import { prepareTurn, type TurnExecutionContext } from "./turn-preparation.js";
import { handleStatusQuery, throwToolApprovalError } from "./turn-direct-helpers.js";
import { isContextOverflowError } from "./session-compaction-service.js";
import { GUARDIAN_REVIEW_DECISION_TOOL_ID } from "./tool-set-builder-internal-tools.js";

export {
  handleStatusQuery,
  throwToolApprovalError,
  maybeStoreToolApprovalArgsHandle,
} from "./turn-direct-helpers.js";

export type GuardianReviewDecisionCollectorResult = NonNullable<
  Awaited<ReturnType<typeof prepareTurn>>["guardianReviewDecisionCollector"]
>;

export interface TurnDirectResult {
  response: AgentTurnResponseT;
  contextReport: AgentContextReport;
  guardianReviewDecisionCollector?: GuardianReviewDecisionCollectorResult;
}

type TurnInvocationOptions = {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  execution?: TurnExecutionContext;
  compactionRetried?: boolean;
};

function createGuardianReviewTurnControl(): {
  stopWhen: Array<ReturnType<typeof stepCountIs>>;
  toolChoice: { type: "tool"; toolName: typeof GUARDIAN_REVIEW_DECISION_TOOL_ID };
  withinTurnLoop: { value: undefined };
} {
  return {
    stopWhen: [stepCountIs(1)],
    toolChoice: { type: "tool", toolName: GUARDIAN_REVIEW_DECISION_TOOL_ID },
    withinTurnLoop: { value: undefined },
  };
}

export async function turnDirect(
  deps: TurnDirectDeps,
  input: AgentTurnRequestT,
  turnOpts?: TurnInvocationOptions,
): Promise<TurnDirectResult> {
  const abortSignal = makeEventfulAbortSignal(turnOpts?.abortSignal);
  const prepared = await prepareTurn(deps.prepareTurnDeps, input, turnOpts?.execution);
  const {
    ctx,
    executionProfile,
    session,
    mainLaneSessionKey,
    model,
    modelResolution,
    toolSet,
    toolCallPolicyStates,
    laneQueue,
    usedTools,
    memoryWriteState,
    userContent,
    contextReport,
    systemPrompt,
    resolved,
    guardianReviewDecisionCollector,
  } = prepared;

  const workScope: WorkScope = {
    tenant_id: session.tenant_id,
    agent_id: session.agent_id,
    workspace_id: session.workspace_id,
  };

  const finalizeAndMaybeCompact = async (params: {
    reply: string;
    turnKind?: "normal" | "skip";
    usage?: ReturnType<typeof extractUsageSnapshot>;
  }) => {
    const response = await finalizeTurn({
      container: deps.opts.container,
      sessionDal: deps.sessionDal,
      ctx,
      session,
      resolved,
      reply: params.reply,
      model,
      usedTools,
      memoryWritten: memoryWriteState.wrote,
      contextReport,
      turnKind: params.turnKind,
    });
    await maybeAutoCompactSession({
      deps,
      tenantId: session.tenant_id,
      ctx,
      sessionId: response.session_id,
      model,
      modelResolution,
      usage: params.usage,
      abortSignal,
      timeoutMs: turnOpts?.timeoutMs,
    });
    return response;
  };

  if (isStatusQuery(resolved.message)) {
    const reply = await handleStatusQuery(deps.opts.container, workScope);
    const response = await finalizeAndMaybeCompact({ reply, turnKind: "skip" });
    return { response, contextReport };
  }

  const intakeResult = await handleIntakeModeDecision(
    { container: deps.opts.container },
    { resolved, workScope },
  );
  if (intakeResult) {
    const response = await finalizeAndMaybeCompact({
      reply: intakeResult.reply,
      turnKind: "skip",
    });
    return { response, contextReport };
  }

  const intake = await resolveIntakeDecision(
    { container: deps.opts.container },
    { input, executionProfile, resolved, mainLaneSessionKey },
  );
  if (intake.mode === "delegate_execute" || intake.mode === "delegate_plan") {
    const delegation = await delegateFromIntake(
      { agentId: deps.agentId, container: deps.opts.container },
      {
        executionProfile,
        mode: intake.mode,
        reason_code: intake.reason_code,
        resolved,
        scope: workScope,
        createdFromSessionKey: mainLaneSessionKey,
      },
    );
    const response = await finalizeAndMaybeCompact({
      reply: delegation.reply,
      turnKind: "skip",
    });
    return { response, contextReport };
  }

  let messages: ModelMessage[] = [{ role: "user" as const, content: userContent }];
  let stepsUsedSoFar = 0;

  const stepApprovalId = turnOpts?.execution?.stepApprovalId;
  if (stepApprovalId) {
    const approval = await deps.approvalDal.getById({
      tenantId: session.tenant_id,
      approvalId: stepApprovalId,
    });
    if (approval && !isApprovalBlockedStatus(approval.status)) {
      const resumeState = extractToolApprovalResumeState(approval.context);
      if (resumeState) {
        for (const toolId of resumeState.used_tools ?? []) {
          usedTools.add(toolId);
        }
        if (resumeState.memory_written) {
          memoryWriteState.wrote = true;
        }
        stepsUsedSoFar = resumeState.steps_used ?? countAssistantMessages(resumeState.messages);
        messages = appendToolApprovalResponseMessage(resumeState.messages, {
          approvalId: resumeState.approval_id,
          approved: approval.status === "approved",
          reason:
            approval.latest_review?.reason ??
            (approval.status === "expired"
              ? "approval expired"
              : approval.status === "cancelled"
                ? "approval cancelled"
                : undefined),
        });
      }
    }
  }

  const remainingSteps = deps.maxSteps - stepsUsedSoFar;
  if (remainingSteps <= 0) {
    const automation = resolveAutomationMetadata(resolved.metadata);
    const reply = automation?.delivery_mode === "quiet" ? "" : "No assistant response returned.";
    const response = await finalizeAndMaybeCompact({ reply, turnKind: "skip" });
    return { response, contextReport };
  }

  const withinTurnCfg = ctx.config.sessions.loop_detection.within_turn;
  const guardianReviewTurnControl = guardianReviewDecisionCollector
    ? createGuardianReviewTurnControl()
    : undefined;
  const withinTurn = guardianReviewTurnControl
    ? guardianReviewTurnControl
    : createStopWhenWithWithinTurnLoopDetection(deps.opts.container.logger, {
        stepLimit: remainingSteps,
        withinTurnCfg,
        sessionId: session.session_id,
        channel: resolved.channel,
        threadId: resolved.thread_id,
      });

  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model,
      system: systemPrompt,
      messages,
      tools: toolSet,
      toolChoice: guardianReviewTurnControl?.toolChoice,
      stopWhen: withinTurn.stopWhen,
      prepareStep: ({ messages: stepMessages }) =>
        prepareLaneQueueStep(laneQueue, stepMessages, ctx.config.sessions.context_pruning),
      abortSignal,
      timeout: turnOpts?.timeoutMs,
    });
  } catch (err) {
    if (!isContextOverflowError(err)) {
      throw err;
    }

    await compactForOverflow({
      deps,
      ctx,
      session,
      model,
      abortSignal,
      timeoutMs: turnOpts?.timeoutMs,
    });

    if (turnOpts?.compactionRetried || usedTools.size > 0) {
      throw err;
    }

    return await turnDirect(deps, input, {
      ...turnOpts,
      abortSignal,
      compactionRetried: true,
    });
  }
  const stepsUsedAfterCall = stepsUsedSoFar + result.steps.length;

  const lastStep = result.steps.at(-1);
  const approvalPart = lastStep?.content.find((part) => {
    const record = coerceRecord(part);
    return record?.["type"] === "tool-approval-request";
  });

  if (approvalPart) {
    await throwToolApprovalError(
      {
        approvalWaitMs: deps.approvalWaitMs,
        secretProvider: deps.secretProvider,
        agentId: deps.agentId,
      },
      approvalPart,
      toolCallPolicyStates,
      session,
      resolved,
      usedTools,
      memoryWriteState,
      stepsUsedAfterCall,
      messages,
      result,
    );
  }

  const rawReply = result.text || "";
  const automation = resolveAutomationMetadata(resolved.metadata);
  const reply = resolveTurnReply(rawReply, withinTurn.withinTurnLoop.value, {
    allowEmpty: automation?.delivery_mode === "quiet" || Boolean(guardianReviewDecisionCollector),
  });
  const response = await finalizeAndMaybeCompact({
    reply,
    turnKind: guardianReviewDecisionCollector ? "skip" : undefined,
    usage: extractUsageSnapshot(result.totalUsage),
  });
  return {
    response,
    contextReport,
    guardianReviewDecisionCollector,
  };
}

export interface TurnStreamDirectResult {
  streamResult: ReturnType<typeof streamText>;
  sessionId: string;
  contextReport: AgentContextReport;
  guardianReviewDecisionCollector?: GuardianReviewDecisionCollectorResult;
  finalize: () => Promise<AgentTurnResponseT>;
}

export async function turnStreamDirect(
  deps: TurnDirectDeps,
  input: AgentTurnRequestT,
): Promise<TurnStreamDirectResult> {
  const prepared = await prepareTurn(deps.prepareTurnDeps, input);
  const {
    ctx,
    executionProfile,
    session,
    mainLaneSessionKey,
    model,
    modelResolution,
    toolSet,
    laneQueue,
    usedTools,
    memoryWriteState,
    userContent,
    contextReport,
    systemPrompt,
    resolved,
    guardianReviewDecisionCollector,
  } = prepared;

  const intake = await resolveIntakeDecision(
    { container: deps.opts.container },
    { input, executionProfile, resolved, mainLaneSessionKey },
  );
  if (intake.mode === "delegate_execute" || intake.mode === "delegate_plan") {
    const delegation = await delegateFromIntake(
      { agentId: deps.agentId, container: deps.opts.container },
      {
        executionProfile,
        mode: intake.mode,
        reason_code: intake.reason_code,
        resolved,
        scope: {
          tenant_id: session.tenant_id,
          agent_id: session.agent_id,
          workspace_id: session.workspace_id,
        },
        createdFromSessionKey: mainLaneSessionKey,
      },
    );
    const response = await finalizeTurn({
      container: deps.opts.container,
      sessionDal: deps.sessionDal,
      ctx,
      session,
      resolved,
      reply: delegation.reply,
      model,
      usedTools,
      memoryWritten: memoryWriteState.wrote,
      contextReport,
      turnKind: "skip",
    });
    await maybeAutoCompactSession({
      deps,
      tenantId: session.tenant_id,
      ctx,
      sessionId: response.session_id,
      model,
      modelResolution,
      usage: undefined,
    });

    const streamResult = streamText({
      model: createStaticLanguageModelV3(delegation.reply),
      system: "",
      messages: [{ role: "user" as const, content: [{ type: "text", text: "" }] }],
      stopWhen: [stepCountIs(1)],
    });

    return {
      streamResult,
      sessionId: session.session_id,
      contextReport,
      guardianReviewDecisionCollector,
      finalize: async () => response,
    };
  }

  const withinTurnCfg = ctx.config.sessions.loop_detection.within_turn;
  const guardianReviewTurnControl = guardianReviewDecisionCollector
    ? createGuardianReviewTurnControl()
    : undefined;
  const withinTurn = guardianReviewTurnControl
    ? guardianReviewTurnControl
    : createStopWhenWithWithinTurnLoopDetection(deps.opts.container.logger, {
        stepLimit: deps.maxSteps,
        withinTurnCfg,
        sessionId: session.session_id,
        channel: resolved.channel,
        threadId: resolved.thread_id,
      });

  const streamResult = streamText({
    model,
    system: systemPrompt,
    messages: [{ role: "user" as const, content: userContent }],
    tools: toolSet,
    toolChoice: guardianReviewTurnControl?.toolChoice,
    stopWhen: withinTurn.stopWhen,
    prepareStep: ({ messages: stepMessages }) =>
      prepareLaneQueueStep(laneQueue, stepMessages, ctx.config.sessions.context_pruning),
  });

  const finalize = async (): Promise<AgentTurnResponseT> => {
    let result: Awaited<typeof streamResult>;
    try {
      result = await streamResult;
    } catch (err) {
      if (isContextOverflowError(err)) {
        await compactForOverflow({ deps, ctx, session, model });
      }
      throw err;
    }
    const rawReply = (await result.text) || "";
    const automation = resolveAutomationMetadata(resolved.metadata);
    const reply = resolveTurnReply(rawReply, withinTurn.withinTurnLoop.value, {
      allowEmpty: automation?.delivery_mode === "quiet" || Boolean(guardianReviewDecisionCollector),
    });
    const response = await finalizeTurn({
      container: deps.opts.container,
      sessionDal: deps.sessionDal,
      ctx,
      session,
      resolved,
      reply,
      model,
      usedTools,
      memoryWritten: memoryWriteState.wrote,
      contextReport,
      turnKind: guardianReviewDecisionCollector ? "skip" : undefined,
    });
    await maybeAutoCompactSession({
      deps,
      tenantId: session.tenant_id,
      ctx,
      sessionId: response.session_id,
      model,
      modelResolution,
      usage: extractUsageSnapshot(await result.totalUsage),
    });
    return response;
  };

  return {
    streamResult,
    sessionId: session.session_id,
    contextReport,
    guardianReviewDecisionCollector,
    finalize,
  };
}

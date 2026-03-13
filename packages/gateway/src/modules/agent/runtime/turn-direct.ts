import { generateText, stepCountIs, streamText } from "ai";
import type { ModelMessage } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  SessionContextState,
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
  createStopWhenWithWithinTurnLoopDetection,
  compactForOverflow,
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
  sessionMessagesToModelMessages,
} from "../../ai-sdk/message-utils.js";
import { prepareTurn, type TurnExecutionContext } from "./turn-preparation.js";
import { handleStatusQuery, throwToolApprovalError } from "./turn-direct-helpers.js";
import { applyDeterministicContextCompactionAndToolPruning } from "./context-pruning.js";
import { buildPromptVisibleMessages } from "./session-context-state.js";
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

function hasPromptInjectedSessionContext(
  contextState: SessionContextState | null | undefined,
): boolean {
  return Boolean(
    contextState?.checkpoint ||
      contextState?.pending_approvals.length ||
      contextState?.pending_tool_state.length,
  );
}

function stripEmbeddedSessionContext(
  userContent: ReadonlyArray<{ type: "text"; text: string }>,
  contextState: SessionContextState | null | undefined,
): Array<{ type: "text"; text: string }> {
  if (!hasPromptInjectedSessionContext(contextState)) {
    return [...userContent];
  }
  return userContent.filter((part) => !part.text.startsWith("Session context:\n"));
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
  let activeSession = session;

  const workScope: WorkScope = {
    tenant_id: session.tenant_id,
    agent_id: session.agent_id,
    workspace_id: session.workspace_id,
  };

  const finalizeAndPersist = async (params: {
    reply: string;
    turnKind?: "normal" | "skip";
    usage?: ReturnType<typeof extractUsageSnapshot>;
    responseMessages?: readonly ModelMessage[];
  }) => {
    const memoryWritten = memoryWriteState?.wrote ?? false;
    return await finalizeTurn({
      container: deps.opts.container,
      sessionDal: deps.sessionDal,
      ctx,
      session: activeSession,
      resolved,
      reply: params.reply,
      model,
      usedTools,
      memoryWritten,
      contextReport,
      turnKind: params.turnKind,
      responseMessages: params.responseMessages,
    });
  };

  if (isStatusQuery(resolved.message)) {
    const reply = await handleStatusQuery(deps.opts.container, workScope);
    const response = await finalizeAndPersist({ reply, turnKind: "skip" });
    return { response, contextReport };
  }

  const intakeResult = await handleIntakeModeDecision(
    { container: deps.opts.container },
    { resolved, workScope },
  );
  if (intakeResult) {
    const response = await finalizeAndPersist({
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
    const response = await finalizeAndPersist({
      reply: delegation.reply,
      turnKind: "skip",
    });
    return { response, contextReport };
  }

  await maybeAutoCompactSession({
    deps,
    tenantId: activeSession.tenant_id,
    ctx,
    sessionId: activeSession.session_id,
    model,
    modelResolution,
    usage: undefined,
    currentTurnText: resolved.message,
    systemPrompt,
    abortSignal,
    timeoutMs: turnOpts?.timeoutMs,
  });
  activeSession =
    (await deps.sessionDal.getById({
      tenantId: activeSession.tenant_id,
      sessionId: activeSession.session_id,
    })) ?? activeSession;
  const promptUserContent = stripEmbeddedSessionContext(userContent, activeSession.context_state);

  let messages: ModelMessage[] = [
    ...(await sessionMessagesToModelMessages(
      buildPromptVisibleMessages(activeSession.messages, activeSession.context_state),
    )),
    { role: "user" as const, content: promptUserContent },
  ];
  let stepsUsedSoFar = 0;

  const stepApprovalId = turnOpts?.execution?.stepApprovalId;
  if (stepApprovalId) {
    const approval = await deps.approvalDal.getById({
      tenantId: activeSession.tenant_id,
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
    const response = await finalizeAndPersist({ reply, turnKind: "skip" });
    return { response, contextReport };
  }

  messages = applyDeterministicContextCompactionAndToolPruning(
    messages,
    ctx.config.sessions.context_pruning,
  );

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

  let result;
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
  } catch (error) {
    if (!turnOpts?.compactionRetried && isContextOverflowError(error)) {
      if (usedTools.size > 0) {
        throw error;
      }
      await compactForOverflow({
        deps,
        ctx,
        session: activeSession,
        model,
        abortSignal,
        timeoutMs: turnOpts?.timeoutMs,
      });
      return await turnDirect(deps, input, { ...turnOpts, compactionRetried: true });
    }
    throw error;
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
      activeSession,
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
  const response = await finalizeAndPersist({
    reply,
    turnKind: guardianReviewDecisionCollector ? "skip" : undefined,
    usage: extractUsageSnapshot(result.totalUsage),
    responseMessages: (result.response?.messages ?? []) as ModelMessage[],
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
  let activeSession = session;

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
      memoryWritten: memoryWriteState?.wrote ?? false,
      contextReport,
      turnKind: "skip",
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

  await maybeAutoCompactSession({
    deps,
    tenantId: activeSession.tenant_id,
    ctx,
    sessionId: activeSession.session_id,
    model,
    modelResolution,
    usage: undefined,
    currentTurnText: resolved.message,
    systemPrompt,
  });
  activeSession =
    (await deps.sessionDal.getById({
      tenantId: activeSession.tenant_id,
      sessionId: activeSession.session_id,
    })) ?? activeSession;
  const promptUserContent = stripEmbeddedSessionContext(userContent, activeSession.context_state);

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
    messages: applyDeterministicContextCompactionAndToolPruning(
      [
        ...(await sessionMessagesToModelMessages(
          buildPromptVisibleMessages(activeSession.messages, activeSession.context_state),
        )),
        { role: "user" as const, content: promptUserContent },
      ],
      ctx.config.sessions.context_pruning,
    ),
    tools: toolSet,
    toolChoice: guardianReviewTurnControl?.toolChoice,
    stopWhen: withinTurn.stopWhen,
    prepareStep: ({ messages: stepMessages }) =>
      prepareLaneQueueStep(laneQueue, stepMessages, ctx.config.sessions.context_pruning),
  });

  const finalize = async (): Promise<AgentTurnResponseT> => {
    const result = await streamResult;
    const rawReply = (await result.text) || "";
    const automation = resolveAutomationMetadata(resolved.metadata);
    const reply = resolveTurnReply(rawReply, withinTurn.withinTurnLoop.value, {
      allowEmpty: automation?.delivery_mode === "quiet" || Boolean(guardianReviewDecisionCollector),
    });
    const modelResponse = await result.response;
    const response = await finalizeTurn({
      container: deps.opts.container,
      sessionDal: deps.sessionDal,
      ctx,
      session: activeSession,
      resolved,
      reply,
      model,
      usedTools,
      memoryWritten: memoryWriteState?.wrote ?? false,
      contextReport,
      turnKind: guardianReviewDecisionCollector ? "skip" : undefined,
      responseMessages: (modelResponse.messages ?? []) as ModelMessage[],
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

import { generateText, streamText } from "ai";
import type { ModelMessage } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  WorkScope,
} from "@tyrum/contracts";
import {
  createGuardianReviewTurnControl,
  type TurnDirectResult,
  type TurnInvocationOptions,
  type TurnStreamDirectResult,
} from "./turn-direct-support.js";
import { extractToolApprovalResumeState, isStatusQuery } from "./turn-helpers.js";
import { isApprovalBlockedStatus } from "../../approval/dal.js";
import { coerceRecord } from "../../util/coerce.js";
import { finalizeTurn } from "./turn-finalization.js";
import { resolveAutomationMetadata } from "./automation-delivery.js";
import {
  createStopWhenWithWithinTurnLoopDetection,
  compactForOverflow,
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
import { prepareTurn } from "./turn-preparation.js";
import { handleStatusQuery, throwToolApprovalError } from "./turn-direct-helpers.js";
import { isContextOverflowError } from "./session-compaction-service.js";
import {
  buildDirectPromptMessages,
  createDirectTurnDownloadFunction,
  pruneDirectPromptMessages,
  reloadActiveSession,
} from "./turn-direct-runtime.js";
import { touchSandboxAttachmentActivity } from "./sandbox-context.js";
export {
  handleStatusQuery,
  throwToolApprovalError,
  maybeStoreToolApprovalArgsHandle,
} from "./turn-direct-helpers.js";
export type { GuardianReviewDecisionCollectorResult } from "./turn-direct-support.js";

export async function turnDirect(
  deps: TurnDirectDeps,
  input: AgentTurnRequestT,
  turnOpts?: TurnInvocationOptions,
): Promise<TurnDirectResult> {
  const abortSignal = makeEventfulAbortSignal(turnOpts?.abortSignal);
  const prepared = await prepareTurn(deps.prepareTurnDeps, input, turnOpts?.execution);
  const {
    ctx,
    session,
    model,
    modelResolution,
    toolSet,
    toolCallPolicyStates,
    laneQueue,
    usedTools,
    memoryWriteState,
    userContent,
    rewriteHistoryAttachmentsForModel,
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
  await touchSandboxAttachmentActivity({
    db: deps.opts.container.db,
    tenantId: session.tenant_id,
    metadata: resolved.metadata,
    logger: deps.opts.container.logger,
  });

  const finalizeAndPersist = async (params: {
    reply: string;
    turnKind?: "normal" | "skip";
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
      turn_id: turnOpts?.execution?.runId,
      model,
      usedTools,
      memoryWritten,
      contextReport,
      turnKind: params.turnKind,
      responseMessages: params.responseMessages,
    });
  };

  const downloadPartUrl = createDirectTurnDownloadFunction(deps);

  if (isStatusQuery(resolved.message)) {
    const reply = await handleStatusQuery(deps.opts.container, workScope);
    const response = await finalizeAndPersist({ reply, turnKind: "skip" });
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
    channel: resolved.channel,
    threadId: resolved.thread_id,
  });
  activeSession = await reloadActiveSession(deps, activeSession);
  let messages: ModelMessage[] | undefined;
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
        if (resumeState.memory_written && memoryWriteState) {
          memoryWriteState.wrote = true;
        }
        stepsUsedSoFar = resumeState.steps_used ?? countAssistantMessages(resumeState.messages);
        messages = pruneDirectPromptMessages(
          appendToolApprovalResponseMessage(resumeState.messages, {
            approvalId: resumeState.approval_id,
            approved: approval.status === "approved",
            reason:
              approval.latest_review?.reason ??
              (approval.status === "expired"
                ? "approval expired"
                : approval.status === "cancelled"
                  ? "approval cancelled"
                  : undefined),
          }),
          ctx.config.sessions.context_pruning,
        );
      }
    }
  }
  const promptMessages =
    messages ??
    (await buildDirectPromptMessages({
      activeSession,
      contextPruning: ctx.config.sessions.context_pruning,
      rewriteHistoryAttachmentsForModel,
      userContent,
    }));

  const remainingSteps = deps.maxSteps - stepsUsedSoFar;
  if (remainingSteps <= 0) {
    const automation = resolveAutomationMetadata(resolved.metadata);
    const reply = automation?.delivery_mode === "quiet" ? "" : "No assistant response returned.";
    const response = await finalizeAndPersist({ reply, turnKind: "skip" });
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

  let result;
  try {
    result = await generateText({
      model,
      system: systemPrompt,
      messages: promptMessages,
      experimental_download: downloadPartUrl,
      tools: toolSet,
      toolChoice: guardianReviewTurnControl?.toolChoice,
      stopWhen: withinTurn.stopWhen,
      prepareStep: ({ messages: stepMessages }: { messages: ModelMessage[] }) =>
        prepareLaneQueueStep(laneQueue, stepMessages, ctx.config.sessions.context_pruning),
      abortSignal,
      timeout: turnOpts?.timeoutMs,
    });
  } catch (error) {
    if (!turnOpts?.compactionRetried && isContextOverflowError(error)) {
      await compactForOverflow({
        deps,
        ctx,
        session: activeSession,
        model,
        abortSignal,
        timeoutMs: turnOpts?.timeoutMs,
        channel: resolved.channel,
        threadId: resolved.thread_id,
      });
      if (usedTools.size > 0) {
        throw error;
      }
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
      promptMessages,
      (result.response?.messages ?? []) as ModelMessage[],
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
    responseMessages: (result.response?.messages ?? []) as ModelMessage[],
  });
  return {
    response,
    contextReport,
    guardianReviewDecisionCollector,
  };
}

export async function turnStreamDirect(
  deps: TurnDirectDeps,
  input: AgentTurnRequestT,
  turnOpts?: TurnInvocationOptions,
): Promise<TurnStreamDirectResult> {
  const abortSignal = makeEventfulAbortSignal(turnOpts?.abortSignal);
  const prepared = await prepareTurn(deps.prepareTurnDeps, input, turnOpts?.execution);
  const {
    ctx,
    session,
    model,
    modelResolution,
    toolSet,
    toolCallPolicyStates,
    laneQueue,
    usedTools,
    memoryWriteState,
    userContent,
    rewriteHistoryAttachmentsForModel,
    contextReport,
    systemPrompt,
    resolved,
    guardianReviewDecisionCollector,
  } = prepared;
  let activeSession = session;
  const downloadPartUrl = createDirectTurnDownloadFunction(deps);
  await touchSandboxAttachmentActivity({
    db: deps.opts.container.db,
    tenantId: session.tenant_id,
    metadata: resolved.metadata,
    logger: deps.opts.container.logger,
  });

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
    channel: resolved.channel,
    threadId: resolved.thread_id,
  });
  activeSession = await reloadActiveSession(deps, activeSession);
  const promptMessages = await buildDirectPromptMessages({
    activeSession,
    contextPruning: ctx.config.sessions.context_pruning,
    rewriteHistoryAttachmentsForModel,
    userContent,
  });

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

  let streamResult: ReturnType<typeof streamText>;
  try {
    streamResult = streamText({
      model,
      system: systemPrompt,
      messages: promptMessages,
      experimental_download: downloadPartUrl,
      tools: toolSet,
      toolChoice: guardianReviewTurnControl?.toolChoice,
      stopWhen: withinTurn.stopWhen,
      prepareStep: ({ messages: stepMessages }: { messages: ModelMessage[] }) =>
        prepareLaneQueueStep(laneQueue, stepMessages, ctx.config.sessions.context_pruning),
      abortSignal,
      timeout: turnOpts?.timeoutMs,
    });
  } catch (error) {
    if (isContextOverflowError(error)) {
      await compactForOverflow({
        deps,
        ctx,
        session: activeSession,
        model,
        channel: resolved.channel,
        threadId: resolved.thread_id,
      });
    }
    throw error;
  }

  const finalize = async (): Promise<AgentTurnResponseT> => {
    let result: Awaited<typeof streamResult>;
    try {
      result = await streamResult;
    } catch (error) {
      if (isContextOverflowError(error)) {
        await compactForOverflow({
          deps,
          ctx,
          session: activeSession,
          model,
          channel: resolved.channel,
          threadId: resolved.thread_id,
        });
      }
      throw error;
    }
    const responseMessages = ((await result.response).messages ?? []) as ModelMessage[];
    const steps = await result.steps;
    const stepsUsedAfterCall = steps.length;
    const lastStep = steps.at(-1);
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
        promptMessages,
        responseMessages,
      );
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
      session: activeSession,
      resolved,
      reply,
      model,
      usedTools,
      memoryWritten: memoryWriteState?.wrote ?? false,
      contextReport,
      turnKind: guardianReviewDecisionCollector ? "skip" : undefined,
      responseMessages,
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

import { generateText, stepCountIs, streamText } from "ai";
import type { ModelMessage } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  WorkScope,
} from "@tyrum/schemas";
import {
  prepareLaneQueueStep as prepareLaneQueueStepBridge,
  type LaneQueueState,
} from "./turn-engine-bridge.js";
import {
  createStaticLanguageModelV3,
  extractToolApprovalResumeState,
  isStatusQuery,
} from "./turn-helpers.js";
import { finalizeTurn } from "./turn-finalization.js";
import type { AgentContextReport, AgentRuntimeOptions } from "./types.js";
import type { SessionDal } from "../session-dal.js";
import { maybeRunPreCompactionMemoryFlush } from "./pre-compaction-memory-flush.js";
import { resolveAutomationMetadata } from "./automation-delivery.js";
import {
  resolveIntakeDecision,
  delegateFromIntake,
  handleIntakeModeDecision,
} from "./intake-delegation.js";
import {
  appendToolApprovalResponseMessage,
  countAssistantMessages,
} from "../../ai-sdk/message-utils.js";
import { coerceRecord } from "../../util/coerce.js";
import type { PrepareTurnDeps } from "./turn-preparation.js";
import { prepareTurn, type TurnExecutionContext } from "./turn-preparation.js";
import { detectWithinTurnToolLoop } from "../loop-detection.js";
import { WITHIN_TURN_LOOP_STOP_REPLY } from "./runtime-constants.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { SecretProvider } from "../../secret/provider.js";
import { handleStatusQuery, throwToolApprovalError } from "./turn-direct-helpers.js";

export {
  handleStatusQuery,
  throwToolApprovalError,
  maybeStoreToolApprovalArgsHandle,
} from "./turn-direct-helpers.js";

export function makeEventfulAbortSignal(
  upstream: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!upstream) return undefined;
  const controller = new AbortController();

  const abortLater = () => {
    queueMicrotask(() => controller.abort());
  };

  upstream.addEventListener("abort", abortLater, { once: true });
  if (upstream.aborted) {
    abortLater();
  }

  return controller.signal;
}

export function createStopWhenWithWithinTurnLoopDetection(
  logger: { warn: (msg: string, fields?: Record<string, unknown>) => void },
  input: {
    stepLimit: number;
    withinTurnCfg: {
      enabled: boolean;
      consecutive_repeat_limit: number;
      cycle_repeat_limit: number;
    };
    sessionId: string;
    channel: string;
    threadId: string;
  },
): {
  stopWhen: Array<ReturnType<typeof stepCountIs>>;
  withinTurnLoop: { value: ReturnType<typeof detectWithinTurnToolLoop> | undefined };
} {
  const withinTurnLoop = {
    value: undefined as ReturnType<typeof detectWithinTurnToolLoop> | undefined,
  };
  const stopWhen = [stepCountIs(input.stepLimit)];

  if (input.withinTurnCfg.enabled) {
    stopWhen.push(({ steps }) => {
      if (withinTurnLoop.value) return true;
      const detected = detectWithinTurnToolLoop({
        steps,
        consecutiveRepeatLimit: input.withinTurnCfg.consecutive_repeat_limit,
        cycleRepeatLimit: input.withinTurnCfg.cycle_repeat_limit,
      });
      if (!detected) return false;
      withinTurnLoop.value = detected;
      logger.warn("agents.loop.within_turn_detected", {
        session_id: input.sessionId,
        channel: input.channel,
        thread_id: input.threadId,
        kind: detected.kind,
        tool_names: detected.toolNames,
      });
      return true;
    });
  }

  return { stopWhen, withinTurnLoop };
}

export function resolveTurnReply(
  rawReply: string,
  withinTurnLoop: ReturnType<typeof detectWithinTurnToolLoop> | undefined,
  opts?: { allowEmpty?: boolean },
): string {
  if (withinTurnLoop) {
    if (rawReply.trim().length === 0) return WITHIN_TURN_LOOP_STOP_REPLY;
    if (rawReply.includes(WITHIN_TURN_LOOP_STOP_REPLY)) return rawReply;
    return `${rawReply}\n\n${WITHIN_TURN_LOOP_STOP_REPLY}`;
  }
  if (rawReply.length > 0) return rawReply;
  if (opts?.allowEmpty) return "";
  return "No assistant response returned.";
}

function prepareLaneQueueStep(
  laneQueue: LaneQueueState | undefined,
  messages: Array<ModelMessage>,
  contextPruning: Parameters<typeof prepareLaneQueueStepBridge>[2],
): { messages: Array<ModelMessage> } {
  return prepareLaneQueueStepBridge(laneQueue, messages, contextPruning);
}

export interface TurnDirectDeps {
  opts: AgentRuntimeOptions;
  prepareTurnDeps: PrepareTurnDeps;
  sessionDal: SessionDal;
  approvalDal: ApprovalDal;
  agentId: string;
  workspaceId: string;
  maxSteps: number;
  approvalWaitMs: number;
  secretProvider?: SecretProvider;
}

export interface TurnDirectResult {
  response: AgentTurnResponseT;
  contextReport: AgentContextReport;
}

export async function turnDirect(
  deps: TurnDirectDeps,
  input: AgentTurnRequestT,
  turnOpts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
): Promise<TurnDirectResult> {
  const abortSignal = makeEventfulAbortSignal(turnOpts?.abortSignal);
  const prepared = await prepareTurn(deps.prepareTurnDeps, input, turnOpts?.execution);
  const {
    ctx,
    executionProfile,
    session,
    mainLaneSessionKey,
    model,
    toolSet,
    toolCallPolicyStates,
    laneQueue,
    usedTools,
    userContent,
    contextReport,
    systemPrompt,
    resolved,
  } = prepared;

  const workScope: WorkScope = {
    tenant_id: session.tenant_id,
    agent_id: session.agent_id,
    workspace_id: session.workspace_id,
  };

  if (isStatusQuery(resolved.message)) {
    const reply = await handleStatusQuery(deps.opts.container, workScope);
    const response = await finalizeTurn({
      container: deps.opts.container,
      sessionDal: deps.sessionDal,
      ctx,
      session,
      resolved,
      reply,
      model,
      usedTools,
      contextReport,
      turnKind: "skip",
    });
    return { response, contextReport };
  }

  const intakeResult = await handleIntakeModeDecision(
    { container: deps.opts.container },
    { resolved, workScope },
  );
  if (intakeResult) {
    const response = await finalizeTurn({
      container: deps.opts.container,
      sessionDal: deps.sessionDal,
      ctx,
      session,
      resolved,
      reply: intakeResult.reply,
      model,
      usedTools,
      contextReport,
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
    const response = await finalizeTurn({
      container: deps.opts.container,
      sessionDal: deps.sessionDal,
      ctx,
      session,
      resolved,
      reply: delegation.reply,
      model,
      usedTools,
      contextReport,
      turnKind: "skip",
    });
    return { response, contextReport };
  }

  await maybeRunPreCompactionMemoryFlush(
    { db: deps.opts.container.db, logger: deps.opts.container.logger, agentId: session.agent_id },
    { ctx, session, model, systemPrompt, abortSignal, timeoutMs: turnOpts?.timeoutMs },
  );

  let messages: ModelMessage[] = [{ role: "user" as const, content: userContent }];
  let stepsUsedSoFar = 0;

  const stepApprovalId = turnOpts?.execution?.stepApprovalId;
  if (stepApprovalId) {
    const approval = await deps.approvalDal.getById({
      tenantId: session.tenant_id,
      approvalId: stepApprovalId,
    });
    if (approval && approval.status !== "pending") {
      const resumeState = extractToolApprovalResumeState(approval.context);
      if (resumeState) {
        for (const toolId of resumeState.used_tools ?? []) {
          usedTools.add(toolId);
        }
        stepsUsedSoFar = resumeState.steps_used ?? countAssistantMessages(resumeState.messages);
        messages = appendToolApprovalResponseMessage(resumeState.messages, {
          approvalId: resumeState.approval_id,
          approved: approval.status === "approved",
          reason: (() => {
            const resolution = coerceRecord(approval.resolution);
            const reason =
              typeof resolution?.["reason"] === "string" ? resolution["reason"].trim() : "";
            if (reason.length > 0) return reason;
            return approval.status === "expired"
              ? "approval expired"
              : approval.status === "cancelled"
                ? "approval cancelled"
                : undefined;
          })(),
        });
      }
    }
  }

  const remainingSteps = deps.maxSteps - stepsUsedSoFar;
  if (remainingSteps <= 0) {
    const automation = resolveAutomationMetadata(resolved.metadata);
    const reply = automation?.delivery_mode === "quiet" ? "" : "No assistant response returned.";
    const response = await finalizeTurn({
      container: deps.opts.container,
      sessionDal: deps.sessionDal,
      ctx,
      session,
      resolved,
      reply,
      model,
      usedTools,
      contextReport,
      turnKind: "skip",
    });
    return { response, contextReport };
  }

  const withinTurnCfg = ctx.config.sessions.loop_detection.within_turn;
  const { stopWhen, withinTurnLoop } = createStopWhenWithWithinTurnLoopDetection(
    deps.opts.container.logger,
    {
      stepLimit: remainingSteps,
      withinTurnCfg,
      sessionId: session.session_id,
      channel: resolved.channel,
      threadId: resolved.thread_id,
    },
  );

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    tools: toolSet,
    stopWhen,
    prepareStep: ({ messages: stepMessages }) =>
      prepareLaneQueueStep(laneQueue, stepMessages, ctx.config.sessions.context_pruning),
    abortSignal,
  });
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
      stepsUsedAfterCall,
      messages,
      result,
    );
  }

  const rawReply = result.text || "";
  const automation = resolveAutomationMetadata(resolved.metadata);
  const reply = resolveTurnReply(rawReply, withinTurnLoop.value, {
    allowEmpty: automation?.delivery_mode === "quiet",
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
    contextReport,
  });
  return { response, contextReport };
}

export interface TurnStreamDirectResult {
  streamResult: ReturnType<typeof streamText>;
  sessionId: string;
  contextReport: AgentContextReport;
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
    toolSet,
    laneQueue,
    usedTools,
    userContent,
    contextReport,
    systemPrompt,
    resolved,
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
      finalize: async () => response,
    };
  }

  await maybeRunPreCompactionMemoryFlush(
    { db: deps.opts.container.db, logger: deps.opts.container.logger, agentId: session.agent_id },
    { ctx, session, model, systemPrompt },
  );

  const withinTurnCfg = ctx.config.sessions.loop_detection.within_turn;
  const { stopWhen, withinTurnLoop } = createStopWhenWithWithinTurnLoopDetection(
    deps.opts.container.logger,
    {
      stepLimit: deps.maxSteps,
      withinTurnCfg,
      sessionId: session.session_id,
      channel: resolved.channel,
      threadId: resolved.thread_id,
    },
  );

  const streamResult = streamText({
    model,
    system: systemPrompt,
    messages: [{ role: "user" as const, content: userContent }],
    tools: toolSet,
    stopWhen,
    prepareStep: ({ messages: stepMessages }) =>
      prepareLaneQueueStep(laneQueue, stepMessages, ctx.config.sessions.context_pruning),
  });

  const finalize = async (): Promise<AgentTurnResponseT> => {
    const result = await streamResult;
    const rawReply = (await result.text) || "";
    const automation = resolveAutomationMetadata(resolved.metadata);
    const reply = resolveTurnReply(rawReply, withinTurnLoop.value, {
      allowEmpty: automation?.delivery_mode === "quiet",
    });
    return await finalizeTurn({
      container: deps.opts.container,
      sessionDal: deps.sessionDal,
      ctx,
      session,
      resolved,
      reply,
      model,
      usedTools,
      contextReport,
    });
  };

  return { streamResult, sessionId: session.session_id, contextReport, finalize };
}

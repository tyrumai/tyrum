import { generateText, stepCountIs, streamText } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  SecretHandle as SecretHandleT,
  WorkScope,
} from "@tyrum/schemas";
import {
  prepareLaneQueueStep as prepareLaneQueueStepBridge,
  type LaneQueueState,
} from "./turn-engine-bridge.js";
import type { ToolCallPolicyState } from "./tool-set-builder.js";
import {
  ToolExecutionApprovalRequiredError,
  createStaticLanguageModelV3,
  extractToolApprovalResumeState,
  isStatusQuery,
  type ResolvedAgentTurnInput,
  type StepPauseRequest,
} from "./turn-helpers.js";
import { finalizeTurn } from "./turn-finalization.js";
import type { AgentContextReport, AgentRuntimeOptions } from "./types.js";
import type { SessionRow } from "../session-dal.js";
import { maybeRunPreCompactionMemoryFlush } from "./pre-compaction-memory-flush.js";
import {
  resolveAutomationMetadata,
} from "./automation-delivery.js";
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
import type { SessionDal } from "../session-dal.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { GatewayContainer } from "../../../container.js";
import type { SecretProvider } from "../../secret/provider.js";

export function makeEventfulAbortSignal(upstream: AbortSignal | undefined): AbortSignal | undefined {
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

export async function handleStatusQuery(
  container: GatewayContainer,
  workScope: WorkScope,
): Promise<string> {
  try {
    const { WorkboardDal } = await import("../../workboard/dal.js");
    const workboard = new WorkboardDal(container.db, container.redactionEngine);
    const { items } = await workboard.listItems({
      scope: workScope,
      statuses: ["doing", "blocked", "ready", "backlog"],
      limit: 50,
    });
    if (items.length === 0) {
      return "WorkBoard status: no active work items.";
    }
    const lines: string[] = ["WorkBoard status:"];
    for (const item of items) {
      lines.push(`- [${item.status}] ${item.work_item_id} — ${item.title}`);
      const tasks = await workboard.listTasks({
        scope: workScope,
        work_item_id: item.work_item_id,
      });
      for (const task of tasks.slice(0, 10)) {
        lines.push(
          `  - task ${task.task_id} (${task.status}) profile=${task.execution_profile}`,
        );
      }
    }
    return lines.join("\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    container.logger.warn("workboard.status_query_failed", { error: message });
    return "WorkBoard status is unavailable.";
  }
}

export async function maybeStoreToolApprovalArgsHandle(
  secretProvider: SecretProvider | undefined,
  agentId: string,
  input: {
    toolId: string;
    toolCallId: string;
    args: unknown;
  },
): Promise<SecretHandleT | undefined> {
  if (!secretProvider) return undefined;

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input.args);
  } catch {
    // Intentional: tool approval arg persistence is best-effort; args may be non-serializable.
    serialized = undefined;
  }
  if (typeof serialized !== "string") return undefined;

  try {
    return await secretProvider.store(
      `tool_approval:${agentId}:${input.toolId}:${input.toolCallId}:args`,
      serialized,
    );
  } catch {
    // Intentional: tool approval arg persistence is best-effort; continue without stored args handle.
    return undefined;
  }
}

export async function throwToolApprovalError(
  deps: {
    approvalWaitMs: number;
    secretProvider?: SecretProvider;
    agentId: string;
  },
  approvalPart: unknown,
  toolCallPolicyStates: Map<string, ToolCallPolicyState>,
  session: SessionRow,
  resolved: ResolvedAgentTurnInput,
  usedTools: Set<string>,
  stepsUsedAfterCall: number,
  messages: ModelMessage[],
  result: Awaited<ReturnType<typeof generateText>>,
): Promise<never> {
  const record = coerceRecord(approvalPart);
  const approvalId =
    typeof record?.["approvalId"] === "string" ? record["approvalId"].trim() : "";
  const toolCall = coerceRecord(record?.["toolCall"]);

  const toolCallId =
    typeof toolCall?.["toolCallId"] === "string" ? toolCall["toolCallId"].trim() : "";
  const toolName =
    typeof toolCall?.["toolName"] === "string" ? toolCall["toolName"].trim() : "";
  const toolArgs = toolCall ? toolCall["input"] : undefined;

  if (!approvalId || !toolCallId || !toolName) {
    throw new Error("tool approval request missing required fields");
  }

  const state = toolCallPolicyStates.get(toolCallId);
  if (!state) {
    throw new Error(
      `tool approval request missing policy state for tool_call_id=${toolCallId}`,
    );
  }

  const responseMessages = (result.response?.messages ?? []) as unknown as ModelMessage[];
  const resumeMessages = [...messages, ...responseMessages];

  const expiresAt = new Date(Date.now() + deps.approvalWaitMs).toISOString();

  const toolArgsHandle = await maybeStoreToolApprovalArgsHandle(
    deps.secretProvider,
    deps.agentId,
    {
      toolId: state.toolDesc.id,
      toolCallId,
      args: state.args ?? toolArgs,
    },
  );

  const policyContext = {
    policy_snapshot_id: state.policySnapshotId,
    agent_id: session.agent_id,
    workspace_id: session.workspace_id,
    suggested_overrides: state.suggestedOverrides,
    applied_override_ids: state.appliedOverrideIds,
  };

  throw new ToolExecutionApprovalRequiredError({
    kind: "workflow_step",
    prompt: `Approve execution of '${state.toolDesc.id}' (risk=${state.toolDesc.risk})`,
    detail: `approval required for tool '${state.toolDesc.id}' (risk=${state.toolDesc.risk})`,
    expiresAt,
    context: {
      source: "agent-tool-execution",
      tool_id: state.toolDesc.id,
      tool_risk: state.toolDesc.risk,
      tool_call_id: toolCallId,
      tool_match_target: state.matchTarget,
      approval_step_index: state.approvalStepIndex ?? 0,
      args: state.args ?? toolArgs,
      session_id: session.session_id,
      channel: resolved.channel,
      thread_id: resolved.thread_id,
      policy: policyContext,
      ai_sdk: {
        approval_id: approvalId,
        messages: resumeMessages,
        used_tools: Array.from(usedTools),
        steps_used: stepsUsedAfterCall,
        tool_args_handle: toolArgsHandle,
      },
    },
  });
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

export async function turnDirect(
  deps: TurnDirectDeps,
  input: AgentTurnRequestT,
  turnOpts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
): Promise<AgentTurnResponseT> {
  const abortSignal = makeEventfulAbortSignal(turnOpts?.abortSignal);
  const prepared = await prepareTurn(deps.prepareTurnDeps, input, turnOpts?.execution);
  const {
    ctx, executionProfile, session, mainLaneSessionKey, model,
    toolSet, toolCallPolicyStates, laneQueue, usedTools, userContent,
    contextReport, systemPrompt, resolved,
  } = prepared;

  const workScope: WorkScope = {
    tenant_id: session.tenant_id,
    agent_id: session.agent_id,
    workspace_id: session.workspace_id,
  };

  if (isStatusQuery(resolved.message)) {
    const reply = await handleStatusQuery(deps.opts.container, workScope);
    return await finalizeTurn({
      container: deps.opts.container, sessionDal: deps.sessionDal,
      ctx, session, resolved, reply, usedTools, contextReport,
    });
  }

  const intakeResult = await handleIntakeModeDecision(
    { container: deps.opts.container },
    { resolved, workScope },
  );
  if (intakeResult) {
    return await finalizeTurn({
      container: deps.opts.container, sessionDal: deps.sessionDal,
      ctx, session, resolved, reply: intakeResult.reply, usedTools, contextReport,
    });
  }

  const intake = await resolveIntakeDecision(
    { container: deps.opts.container },
    { input, executionProfile, resolved, mainLaneSessionKey },
  );
  if (intake.mode === "delegate_execute" || intake.mode === "delegate_plan") {
    const delegation = await delegateFromIntake(
      { agentId: deps.agentId, container: deps.opts.container },
      {
        executionProfile, mode: intake.mode, reason_code: intake.reason_code, resolved,
        scope: workScope, createdFromSessionKey: mainLaneSessionKey,
      },
    );
    return await finalizeTurn({
      container: deps.opts.container, sessionDal: deps.sessionDal,
      ctx, session, resolved, reply: delegation.reply, usedTools, contextReport,
    });
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
    return await finalizeTurn({
      container: deps.opts.container, sessionDal: deps.sessionDal,
      ctx, session, resolved, reply, usedTools, contextReport,
    });
  }

  const withinTurnCfg = ctx.config.sessions.loop_detection.within_turn;
  const { stopWhen, withinTurnLoop } = createStopWhenWithWithinTurnLoopDetection(
    deps.opts.container.logger,
    {
      stepLimit: remainingSteps, withinTurnCfg,
      sessionId: session.session_id, channel: resolved.channel, threadId: resolved.thread_id,
    },
  );

  const result = await generateText({
    model, system: systemPrompt, messages, tools: toolSet, stopWhen,
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
      { approvalWaitMs: deps.approvalWaitMs, secretProvider: deps.secretProvider, agentId: deps.agentId },
      approvalPart, toolCallPolicyStates, session, resolved,
      usedTools, stepsUsedAfterCall, messages, result,
    );
  }

  const rawReply = result.text || "";
  const automation = resolveAutomationMetadata(resolved.metadata);
  const reply = resolveTurnReply(rawReply, withinTurnLoop.value, {
    allowEmpty: automation?.delivery_mode === "quiet",
  });
  return await finalizeTurn({
    container: deps.opts.container, sessionDal: deps.sessionDal,
    ctx, session, resolved, reply, usedTools, contextReport,
  });
}

export async function turnStreamDirect(
  deps: TurnDirectDeps,
  input: AgentTurnRequestT,
): Promise<{
  streamResult: ReturnType<typeof streamText>;
  sessionId: string;
  finalize: () => Promise<AgentTurnResponseT>;
}> {
  const prepared = await prepareTurn(deps.prepareTurnDeps, input);
  const {
    ctx, executionProfile, session, mainLaneSessionKey, model,
    toolSet, laneQueue, usedTools, userContent, contextReport, systemPrompt, resolved,
  } = prepared;

  const intake = await resolveIntakeDecision(
    { container: deps.opts.container },
    { input, executionProfile, resolved, mainLaneSessionKey },
  );
  if (intake.mode === "delegate_execute" || intake.mode === "delegate_plan") {
    const delegation = await delegateFromIntake(
      { agentId: deps.agentId, container: deps.opts.container },
      {
        executionProfile, mode: intake.mode, reason_code: intake.reason_code, resolved,
        scope: { tenant_id: session.tenant_id, agent_id: session.agent_id, workspace_id: session.workspace_id },
        createdFromSessionKey: mainLaneSessionKey,
      },
    );
    const response = await finalizeTurn({
      container: deps.opts.container, sessionDal: deps.sessionDal,
      ctx, session, resolved, reply: delegation.reply, usedTools, contextReport,
    });

    const streamResult = streamText({
      model: createStaticLanguageModelV3(delegation.reply),
      system: "",
      messages: [{ role: "user" as const, content: [{ type: "text", text: "" }] }],
      stopWhen: [stepCountIs(1)],
    });

    return { streamResult, sessionId: session.session_id, finalize: async () => response };
  }

  await maybeRunPreCompactionMemoryFlush(
    { db: deps.opts.container.db, logger: deps.opts.container.logger, agentId: session.agent_id },
    { ctx, session, model, systemPrompt },
  );

  const withinTurnCfg = ctx.config.sessions.loop_detection.within_turn;
  const { stopWhen, withinTurnLoop } = createStopWhenWithWithinTurnLoopDetection(
    deps.opts.container.logger,
    {
      stepLimit: deps.maxSteps, withinTurnCfg,
      sessionId: session.session_id, channel: resolved.channel, threadId: resolved.thread_id,
    },
  );

  const streamResult = streamText({
    model, system: systemPrompt,
    messages: [{ role: "user" as const, content: userContent }],
    tools: toolSet, stopWhen,
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
      container: deps.opts.container, sessionDal: deps.sessionDal,
      ctx, session, resolved, reply, usedTools, contextReport,
    });
  };

  return { streamResult, sessionId: session.session_id, finalize };
}

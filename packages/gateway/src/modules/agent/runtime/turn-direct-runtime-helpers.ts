import { stepCountIs } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import {
  prepareLaneQueueStep as prepareLaneQueueStepBridge,
  type LaneQueueState,
} from "./turn-engine-bridge.js";
import type { AgentLoadedContext, AgentRuntimeOptions } from "./types.js";
import type { SessionDal, SessionRow } from "../session-dal.js";
import type { PrepareTurnDeps } from "./turn-preparation.js";
import type { ResolvedSessionModel } from "./session-model-resolution.js";
import { detectWithinTurnToolLoop } from "../loop-detection.js";
import { WITHIN_TURN_LOOP_STOP_REPLY } from "./runtime-constants.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { SecretProvider } from "../../secret/provider.js";
import {
  compactSessionWithResolvedModel,
  type SessionUsageSnapshot,
  shouldCompactSessionForUsage,
} from "./session-compaction-service.js";

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

export function prepareLaneQueueStep(
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

export async function maybeAutoCompactSession(input: {
  deps: TurnDirectDeps;
  tenantId: string;
  ctx: AgentLoadedContext;
  sessionId: string;
  model: LanguageModel;
  modelResolution: ResolvedSessionModel;
  usage: SessionUsageSnapshot | undefined;
  currentTurnText?: string;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  channel?: string;
  threadId?: string;
}): Promise<void> {
  const persisted = await input.deps.sessionDal.getById({
    tenantId: input.tenantId,
    sessionId: input.sessionId,
  });
  if (!persisted) {
    return;
  }

  if (
    !shouldCompactSessionForUsage({
      config: input.ctx.config,
      session: persisted,
      modelResolution: input.modelResolution,
      usage: input.usage,
      currentTurnText: input.currentTurnText,
      systemPrompt: input.systemPrompt,
    })
  ) {
    return;
  }

  await compactSessionWithResolvedModel({
    container: input.deps.opts.container,
    sessionDal: input.deps.sessionDal,
    ctx: input.ctx,
    session: persisted,
    model: input.model,
    abortSignal: input.abortSignal,
    timeoutMs: input.timeoutMs,
    logger: input.deps.opts.container.logger,
    prepareTurnDeps: input.deps.prepareTurnDeps,
    channel: input.channel,
    threadId: input.threadId,
  });
}

export async function compactForOverflow(input: {
  deps: TurnDirectDeps;
  ctx: AgentLoadedContext;
  session: SessionRow;
  model: LanguageModel;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  channel?: string;
  threadId?: string;
}): Promise<void> {
  await compactSessionWithResolvedModel({
    container: input.deps.opts.container,
    sessionDal: input.deps.sessionDal,
    ctx: input.ctx,
    session: input.session,
    model: input.model,
    abortSignal: input.abortSignal,
    timeoutMs: input.timeoutMs,
    logger: input.deps.opts.container.logger,
    prepareTurnDeps: input.deps.prepareTurnDeps,
    channel: input.channel,
    threadId: input.threadId,
  });
}

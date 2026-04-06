import type { UIMessageChunk, streamText } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/contracts";
import { maybeResolvePausedTurn } from "./turn-engine-bridge-turn-state.js";
import type { TurnEngineBridgeDeps, TurnEngineStreamBridgeDeps } from "./turn-engine-bridge.js";
import { prepareConversationTurnRun } from "./turn-engine-bridge-execution.js";
import { TurnRunner, type TurnRunnerTurn } from "./turn-runner.js";
import { checkpointApprovalId, pauseReason } from "./turn-via-turn-runner-approval.js";
import {
  createTurnApproval,
  type ConversationTurnExecutionDeps,
  loadTurnStatus,
  resolveSucceededTurn,
  resolveTerminalTurn,
  sleep,
  startHeartbeat,
  TurnRunnerTerminalError,
} from "./turn-via-turn-runner-support.js";

export const TURN_RUNNER_LEASE_TTL_MS = 30_000;
const TURN_RUNNER_HEARTBEAT_MS = 5_000;
const TURN_RUNNER_CLAIM_RETRY_MS = 25;
const PAUSED_STREAM_RESULT = Symbol("paused-turn-runner-stream");

export type PreparedConversationTurnExecution = {
  planId: string;
  deadlineMs: number;
  key: string;
  turnId: string;
  startMs: number;
  workerId: string;
};

export async function executeClaimedConversationTurn(input: {
  deps: ConversationTurnExecutionDeps;
  request: AgentTurnRequestT;
  prepared: PreparedConversationTurnExecution;
  runner: TurnRunner;
  claimedTurn: TurnRunnerTurn;
  resumeApprovalId?: string;
}): Promise<
  { kind: "completed"; response: AgentTurnResponseT } | { kind: "paused"; resumeApprovalId: string }
> {
  const resumeApprovalId =
    input.resumeApprovalId ?? checkpointApprovalId(input.claimedTurn.checkpoint);
  const stopHeartbeat = startHeartbeat({
    deps: input.deps,
    runner: input.runner,
    turnId: input.prepared.turnId,
    owner: input.prepared.workerId,
    heartbeatMs: TURN_RUNNER_HEARTBEAT_MS,
    leaseTtlMs: TURN_RUNNER_LEASE_TTL_MS,
  });
  const remainingMs = Math.max(1, input.prepared.deadlineMs - Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remainingMs);

  try {
    const response = await input.deps.executeTurn(input.request, {
      abortSignal: controller.signal,
      timeoutMs: remainingMs,
      execution: {
        planId: input.prepared.planId,
        turnId: input.prepared.turnId,
        stepApprovalId: resumeApprovalId,
      },
    });
    clearTimeout(timer);
    stopHeartbeat();
    const completed = await input.runner.complete({
      tenantId: input.deps.tenantId,
      turnId: input.prepared.turnId,
      owner: input.prepared.workerId,
      nowIso: new Date().toISOString(),
    });
    if (!completed) {
      const finalRun = await loadTurnStatus(input.deps, input.prepared.turnId);
      return {
        kind: "completed",
        response: await resolveTerminalTurn(
          input.deps,
          input.prepared.turnId,
          finalRun.status,
          finalRun,
        ),
      };
    }
    return { kind: "completed", response };
  } catch (error) {
    clearTimeout(timer);
    stopHeartbeat();
    if (error instanceof TurnRunnerTerminalError) {
      throw error;
    }
    if (input.deps.isToolExecutionApprovalRequiredError(error)) {
      const created = await createTurnApproval({
        deps: input.deps,
        turnId: input.prepared.turnId,
        planId: input.prepared.planId,
        key: input.prepared.key,
        pause: error.pause,
      });
      const paused = await input.runner.pause({
        tenantId: input.deps.tenantId,
        turnId: input.prepared.turnId,
        owner: input.prepared.workerId,
        nowIso: new Date().toISOString(),
        reason: pauseReason(error.pause.kind),
        detail: input.deps.redactText(error.pause.detail),
        checkpoint: { resume_approval_id: created.approvalId },
      });
      if (!paused) {
        throw new Error(`failed to pause conversation turn '${input.prepared.turnId}'`);
      }
      return { kind: "paused", resumeApprovalId: created.approvalId };
    }

    const message = error instanceof Error ? error.message : String(error);
    const failed = await input.runner.fail({
      tenantId: input.deps.tenantId,
      turnId: input.prepared.turnId,
      owner: input.prepared.workerId,
      nowIso: new Date().toISOString(),
      error: message,
    });
    if (!failed) {
      const finalRun = await loadTurnStatus(input.deps, input.prepared.turnId);
      return {
        kind: "completed",
        response: await resolveTerminalTurn(
          input.deps,
          input.prepared.turnId,
          finalRun.status,
          finalRun,
        ),
      };
    }
    throw error;
  }
}

export async function turnViaTurnRunner(
  deps: TurnEngineBridgeDeps,
  input: AgentTurnRequestT,
): Promise<AgentTurnResponseT> {
  const prepared = await prepareConversationTurnRun(deps, input, { steps: [] });
  const runner = new TurnRunner(deps.db);
  let resumeApprovalId: string | undefined;
  const executionDeps: ConversationTurnExecutionDeps = {
    tenantId: deps.tenantId,
    approvalPollMs: deps.approvalPollMs,
    db: deps.db,
    policyService: deps.policyService,
    approvalDal: deps.approvalDal,
    turnController: deps.turnController,
    redactText: deps.redactText,
    redactUnknown: deps.redactUnknown,
    isToolExecutionApprovalRequiredError: deps.isToolExecutionApprovalRequiredError,
    executeTurn: deps.turnDirect,
  };

  while (Date.now() < prepared.deadlineMs) {
    const now = new Date();
    const claimed = await runner.claim({
      tenantId: deps.tenantId,
      turnId: prepared.turnId,
      owner: prepared.workerId,
      nowMs: now.getTime(),
      nowIso: now.toISOString(),
      leaseTtlMs: TURN_RUNNER_LEASE_TTL_MS,
    });

    if (claimed.kind !== "claimed") {
      if (claimed.kind === "terminal") {
        const finalRun = await loadTurnStatus(deps, prepared.turnId);
        return await resolveTerminalTurn(deps, prepared.turnId, claimed.status, finalRun);
      }
      if (claimed.kind === "lease_unavailable") {
        const remainingMs = Math.max(1, prepared.deadlineMs - Date.now());
        await new Promise((resolve) => setTimeout(resolve, Math.min(25, remainingMs)));
        continue;
      }
      if (claimed.kind === "not_claimable" && claimed.status === "paused") {
        const resolvedPause = await maybeResolvePausedTurn(deps, prepared.turnId);
        if (!resolvedPause) {
          const remainingMs = Math.max(1, prepared.deadlineMs - Date.now());
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(deps.approvalPollMs, remainingMs)),
          );
        }
        continue;
      }
      throw new Error(`failed to claim conversation turn '${prepared.turnId}': ${claimed.kind}`);
    }

    const outcome = await executeClaimedConversationTurn({
      deps: executionDeps,
      request: input,
      prepared,
      runner,
      claimedTurn: claimed.turn,
      resumeApprovalId,
    });
    if (outcome.kind === "completed") {
      return outcome.response;
    }
    resumeApprovalId = outcome.resumeApprovalId;
  }

  const finalRun = await loadTurnStatus(deps, prepared.turnId);
  if (finalRun.status === "succeeded") {
    return await resolveSucceededTurn(deps, prepared.turnId);
  }
  if (finalRun.status === "cancelled" || finalRun.status === "failed") {
    throw new Error(
      finalRun.blocked_detail ?? finalRun.blocked_reason ?? `turn ${finalRun.status}`,
    );
  }

  const timeoutMessage = `conversation turn '${prepared.turnId}' did not complete within ${String(
    Math.max(0, Date.now() - prepared.startMs),
  )}ms`;
  await deps.turnController.cancelTurn(prepared.turnId, timeoutMessage);
  throw new Error(timeoutMessage);
}

async function waitForPausedTurnCompletion(input: {
  deps: TurnEngineStreamBridgeDeps;
  executionDeps: ConversationTurnExecutionDeps;
  request: AgentTurnRequestT;
  prepared: PreparedConversationTurnExecution;
  runner: TurnRunner;
  resumeApprovalId?: string;
}): Promise<AgentTurnResponseT> {
  let resumeApprovalId = input.resumeApprovalId;

  for (;;) {
    const current = await loadTurnStatus(input.deps, input.prepared.turnId);
    if (current.status === "succeeded") {
      return await resolveSucceededTurn(input.deps, input.prepared.turnId);
    }
    if (current.status === "cancelled" || current.status === "failed") {
      return await resolveTerminalTurn(input.deps, input.prepared.turnId, current.status, current);
    }

    if (current.status === "paused") {
      const resolvedPause = await maybeResolvePausedTurn(input.deps, input.prepared.turnId);
      if (!resolvedPause) {
        await sleep(input.deps.approvalPollMs);
      }
      continue;
    }

    const now = new Date();
    const claimed = await input.runner.claim({
      tenantId: input.deps.tenantId,
      turnId: input.prepared.turnId,
      owner: input.prepared.workerId,
      nowMs: now.getTime(),
      nowIso: now.toISOString(),
      leaseTtlMs: TURN_RUNNER_LEASE_TTL_MS,
    });
    if (claimed.kind !== "claimed") {
      if (claimed.kind === "terminal") {
        const finalRun = await loadTurnStatus(input.deps, input.prepared.turnId);
        return await resolveTerminalTurn(
          input.deps,
          input.prepared.turnId,
          claimed.status,
          finalRun,
        );
      }
      if (claimed.kind === "not_claimable" && claimed.status === "paused") {
        continue;
      }
      await sleep(TURN_RUNNER_CLAIM_RETRY_MS);
      continue;
    }

    const resumedPrepared: PreparedConversationTurnExecution = {
      ...input.prepared,
      deadlineMs: Date.now() + input.deps.turnEngineWaitMs,
      startMs: Date.now(),
    };
    const outcome = await executeClaimedConversationTurn({
      deps: input.executionDeps,
      request: input.request,
      prepared: resumedPrepared,
      runner: input.runner,
      claimedTurn: claimed.turn,
      resumeApprovalId,
    });
    if (outcome.kind === "completed") {
      return outcome.response;
    }
    resumeApprovalId = outcome.resumeApprovalId;
  }
}

export async function turnViaTurnRunnerStream(
  deps: TurnEngineStreamBridgeDeps,
  input: AgentTurnRequestT,
): Promise<{
  finalize: () => Promise<AgentTurnResponseT>;
  outcome: Promise<"completed" | "paused">;
  streamResult: Pick<ReturnType<typeof streamText>, "toUIMessageStream">;
}> {
  const prepared = await prepareConversationTurnRun(deps, input, { steps: [] });
  const runner = new TurnRunner(deps.db);
  let resumeApprovalId: string | undefined;
  let innerStreamResult: ReturnType<typeof streamText> | undefined;
  let settleOutcome:
    | {
        kind: "pending";
        reject: (reason?: unknown) => void;
        resolve: (value: "completed" | "paused") => void;
      }
    | { kind: "settled" } = { kind: "settled" };
  let settleStream:
    | { kind: "pending"; reject: (reason?: unknown) => void; resolve: () => void }
    | { kind: "settled" } = { kind: "settled" };

  const outcome = new Promise<"completed" | "paused">((resolve, reject) => {
    settleOutcome = { kind: "pending", reject, resolve };
  });
  const streamReady = new Promise<void>((resolve, reject) => {
    settleStream = { kind: "pending", reject, resolve };
  });
  void outcome.catch(() => undefined);
  void streamReady.catch(() => undefined);

  const resolveOutcome = (value: "completed" | "paused"): void => {
    if (settleOutcome.kind !== "pending") {
      return;
    }
    const current = settleOutcome;
    settleOutcome = { kind: "settled" };
    current.resolve(value);
  };

  const rejectOutcome = (error: unknown): void => {
    if (settleOutcome.kind !== "pending") {
      return;
    }
    const current = settleOutcome;
    settleOutcome = { kind: "settled" };
    current.reject(error);
  };

  const resolveStream = (): void => {
    if (settleStream.kind !== "pending") {
      return;
    }
    const current = settleStream;
    settleStream = { kind: "settled" };
    current.resolve();
  };

  const rejectStream = (error: unknown): void => {
    if (settleStream.kind !== "pending") {
      return;
    }
    const current = settleStream;
    settleStream = { kind: "settled" };
    current.reject(error);
  };

  let streamedAttemptStarted = false;
  const executionDeps: ConversationTurnExecutionDeps = {
    tenantId: deps.tenantId,
    approvalPollMs: deps.approvalPollMs,
    db: deps.db,
    policyService: deps.policyService,
    approvalDal: deps.approvalDal,
    turnController: deps.turnController,
    redactText: deps.redactText,
    redactUnknown: deps.redactUnknown,
    isToolExecutionApprovalRequiredError: deps.isToolExecutionApprovalRequiredError,
    executeTurn: async (request, turnOpts) => {
      if (!streamedAttemptStarted) {
        streamedAttemptStarted = true;
        const handle = await deps.turnStream(request, turnOpts);
        innerStreamResult = handle.streamResult;
        resolveStream();
        return await handle.finalize();
      }
      return await deps.turnDirect(request, turnOpts);
    },
  };

  const finalizedTurn = (async (): Promise<AgentTurnResponseT | typeof PAUSED_STREAM_RESULT> => {
    while (Date.now() < prepared.deadlineMs) {
      const now = new Date();
      const claimed = await runner.claim({
        tenantId: deps.tenantId,
        turnId: prepared.turnId,
        owner: prepared.workerId,
        nowMs: now.getTime(),
        nowIso: now.toISOString(),
        leaseTtlMs: TURN_RUNNER_LEASE_TTL_MS,
      });

      if (claimed.kind !== "claimed") {
        if (claimed.kind === "terminal") {
          const finalRun = await loadTurnStatus(deps, prepared.turnId);
          const response = await resolveTerminalTurn(
            deps,
            prepared.turnId,
            claimed.status,
            finalRun,
          );
          resolveOutcome("completed");
          return response;
        }
        if (claimed.kind === "lease_unavailable") {
          const remainingMs = Math.max(1, prepared.deadlineMs - Date.now());
          await sleep(Math.min(TURN_RUNNER_CLAIM_RETRY_MS, remainingMs));
          continue;
        }
        if (claimed.kind === "not_claimable" && claimed.status === "paused") {
          resolveOutcome("paused");
          return PAUSED_STREAM_RESULT;
        }
        throw new Error(`failed to claim conversation turn '${prepared.turnId}': ${claimed.kind}`);
      }

      const turnOutcome = await executeClaimedConversationTurn({
        deps: executionDeps,
        request: input,
        prepared,
        runner,
        claimedTurn: claimed.turn,
        resumeApprovalId,
      });
      if (turnOutcome.kind === "completed") {
        resolveOutcome("completed");
        return turnOutcome.response;
      }
      resumeApprovalId = turnOutcome.resumeApprovalId;
      resolveOutcome("paused");
      return PAUSED_STREAM_RESULT;
    }

    const finalRun = await loadTurnStatus(deps, prepared.turnId);
    if (finalRun.status === "succeeded") {
      const response = await resolveSucceededTurn(deps, prepared.turnId);
      resolveOutcome("completed");
      return response;
    }
    if (finalRun.status === "cancelled" || finalRun.status === "failed") {
      return await resolveTerminalTurn(deps, prepared.turnId, finalRun.status, finalRun);
    }

    const timeoutMessage = `conversation turn '${prepared.turnId}' did not complete within ${String(
      Math.max(0, Date.now() - prepared.startMs),
    )}ms`;
    await deps.turnController.cancelTurn(prepared.turnId, timeoutMessage);
    throw new Error(timeoutMessage);
  })().catch((error: unknown) => {
    rejectStream(error);
    rejectOutcome(error);
    throw error;
  });

  const completedTurn = (async (): Promise<AgentTurnResponseT> => {
    const result = await finalizedTurn;
    if (result !== PAUSED_STREAM_RESULT) {
      return result;
    }
    return await waitForPausedTurnCompletion({
      deps,
      executionDeps,
      request: input,
      prepared,
      runner,
      resumeApprovalId,
    });
  })();

  void completedTurn.catch(() => undefined);

  return {
    finalize: async () => await completedTurn,
    outcome,
    streamResult: {
      toUIMessageStream: (options?: unknown) =>
        new ReadableStream<UIMessageChunk>({
          start: async (controller) => {
            try {
              await streamReady;
              if (!innerStreamResult) {
                throw new Error("stream result not initialized");
              }
              const sourceStream = innerStreamResult.toUIMessageStream(options as never);
              for await (const chunk of sourceStream) {
                controller.enqueue(chunk as UIMessageChunk);
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        }),
    } as Pick<ReturnType<typeof streamText>, "toUIMessageStream">,
  };
}

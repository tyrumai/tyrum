import type { StepExecutor } from "../../execution/engine.js";
import type { UIMessageChunk } from "ai";
import type { streamText } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/contracts";
import { maybeResolvePausedRun } from "./turn-engine-bridge-run-state.js";
import type { TurnEngineStreamBridgeDeps } from "./turn-engine-bridge.js";
import {
  cleanupTurnExecutionTimeout,
  createTurnExecutor,
  prepareTurnExecution,
  resolveIfTerminal,
  type RunStatusRow,
} from "./turn-engine-bridge-execution.js";

const TURN_ENGINE_MIN_BACKOFF_MS = 5;
const TURN_ENGINE_MAX_BACKOFF_MS = 250;
const PAUSED_STREAM_RESULT = Symbol("paused-stream-result");

async function loadRunStatus(
  deps: Pick<TurnEngineStreamBridgeDeps, "db">,
  runId: string,
): Promise<RunStatusRow> {
  const run = await deps.db.get<RunStatusRow>(
    `SELECT status, blocked_reason AS paused_reason, blocked_detail AS paused_detail
       FROM turns
       WHERE turn_id = ?`,
    [runId],
  );
  if (!run) {
    throw new Error(`execution run '${runId}' not found`);
  }
  return run;
}

async function waitForPausedTurnCompletion(
  deps: TurnEngineStreamBridgeDeps,
  input: {
    executor: StepExecutor;
    getLaneQueueInterrupted: () => boolean;
    getLaneQueueInterruptReason: () => string | undefined;
    runId: string;
    workerId: string;
  },
): Promise<AgentTurnResponseT> {
  let backoffMs = TURN_ENGINE_MIN_BACKOFF_MS;

  for (;;) {
    const run = await loadRunStatus(deps, input.runId);
    const resolved = await resolveIfTerminal(
      deps,
      {
        getLaneQueueInterrupted: input.getLaneQueueInterrupted,
        getLaneQueueInterruptReason: input.getLaneQueueInterruptReason,
        runId: input.runId,
      },
      run,
    );
    if (resolved) {
      return resolved;
    }

    if (run.status === "paused") {
      const resolvedPause = await maybeResolvePausedRun(deps, input.runId);
      if (!resolvedPause) {
        await new Promise((resolve) => setTimeout(resolve, deps.approvalPollMs));
      } else {
        backoffMs = TURN_ENGINE_MIN_BACKOFF_MS;
      }
      continue;
    }

    const didWork = await deps.executionEngine.workerTick({
      workerId: input.workerId,
      executor: input.executor,
      runId: input.runId,
    });
    if (!didWork) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(TURN_ENGINE_MAX_BACKOFF_MS, backoffMs * 2);
    } else {
      backoffMs = TURN_ENGINE_MIN_BACKOFF_MS;
    }
  }
}

export async function turnViaExecutionEngineStream(
  deps: TurnEngineStreamBridgeDeps,
  input: AgentTurnRequestT,
): Promise<{
  finalize: () => Promise<AgentTurnResponseT>;
  outcome: Promise<"completed" | "paused">;
  streamResult: Pick<ReturnType<typeof streamText>, "toUIMessageStream">;
}> {
  const prepared = await prepareTurnExecution(deps, input);
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

  const interruptState = createTurnExecutor(deps, {
    deadlineMs: prepared.deadlineMs,
    executeTurn: async (request, turnOpts) => {
      const handle = await deps.turnStream(request, turnOpts);
      innerStreamResult = handle.streamResult;
      resolveStream();
      return await handle.finalize();
    },
    runId: prepared.runId,
  });

  const finalizedTurn = (async (): Promise<AgentTurnResponseT | typeof PAUSED_STREAM_RESULT> => {
    let backoffMs = TURN_ENGINE_MIN_BACKOFF_MS;
    let pausedOutcomeEmitted = false;

    while (Date.now() < prepared.deadlineMs) {
      const run = await loadRunStatus(deps, prepared.runId);

      if (run.status === "paused") {
        if (!pausedOutcomeEmitted) {
          pausedOutcomeEmitted = true;
          resolveOutcome("paused");
        }
        return PAUSED_STREAM_RESULT;
      }

      const resolved = await resolveIfTerminal(
        deps,
        {
          getLaneQueueInterrupted: interruptState.getLaneQueueInterrupted,
          getLaneQueueInterruptReason: interruptState.getLaneQueueInterruptReason,
          runId: prepared.runId,
        },
        run,
      );
      if (resolved) {
        if (!pausedOutcomeEmitted) {
          resolveOutcome("completed");
        }
        return resolved;
      }

      const didWork = await deps.executionEngine.workerTick({
        workerId: prepared.workerId,
        executor: interruptState.executor,
        runId: prepared.runId,
      });

      if (!didWork) {
        const remainingMs = Math.max(1, prepared.deadlineMs - Date.now());
        const sleepMs = Math.min(backoffMs, remainingMs);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
        backoffMs = Math.min(TURN_ENGINE_MAX_BACKOFF_MS, backoffMs * 2);
      } else {
        backoffMs = TURN_ENGINE_MIN_BACKOFF_MS;
      }
    }

    const completed = await loadRunStatus(deps, prepared.runId);
    if (completed.status === "paused" && !pausedOutcomeEmitted) {
      pausedOutcomeEmitted = true;
      resolveOutcome("paused");
      return PAUSED_STREAM_RESULT;
    }

    const resolved = await resolveIfTerminal(
      deps,
      {
        getLaneQueueInterrupted: interruptState.getLaneQueueInterrupted,
        getLaneQueueInterruptReason: interruptState.getLaneQueueInterruptReason,
        runId: prepared.runId,
      },
      completed,
    );
    if (resolved) {
      if (!pausedOutcomeEmitted) {
        resolveOutcome("completed");
      }
      return resolved;
    }

    const elapsed = Math.max(0, Date.now() - prepared.startMs);
    const timeoutMessage = `execution run '${prepared.runId}' did not complete within ${String(elapsed)}ms`;
    const cancelOutcome = await deps.executionEngine.cancelRun(prepared.runId, timeoutMessage);
    await cleanupTurnExecutionTimeout(deps, prepared);

    if (cancelOutcome === "already_terminal") {
      const latest = await deps.db.get<RunStatusRow>(
        `SELECT status, blocked_reason AS paused_reason, blocked_detail AS paused_detail
           FROM turns
           WHERE turn_id = ?`,
        [prepared.runId],
      );
      if (latest?.status === "paused" && !pausedOutcomeEmitted) {
        pausedOutcomeEmitted = true;
        resolveOutcome("paused");
      }
      if (latest) {
        const terminal = await resolveIfTerminal(
          deps,
          {
            getLaneQueueInterrupted: interruptState.getLaneQueueInterrupted,
            getLaneQueueInterruptReason: interruptState.getLaneQueueInterruptReason,
            runId: prepared.runId,
          },
          latest,
        );
        if (terminal) {
          if (!pausedOutcomeEmitted) {
            resolveOutcome("completed");
          }
          return terminal;
        }
      }
    }

    throw new Error(timeoutMessage);
  })().catch((error: unknown) => {
    rejectStream(error);
    rejectOutcome(error);
    throw error;
  });

  void finalizedTurn.catch(() => undefined);

  return {
    finalize: async () => {
      const result = await finalizedTurn;
      if (result !== PAUSED_STREAM_RESULT) {
        return result;
      }
      return await waitForPausedTurnCompletion(deps, {
        executor: interruptState.executor,
        getLaneQueueInterrupted: interruptState.getLaneQueueInterrupted,
        getLaneQueueInterruptReason: interruptState.getLaneQueueInterruptReason,
        runId: prepared.runId,
        workerId: prepared.workerId,
      });
    },
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

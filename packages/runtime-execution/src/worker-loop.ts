import type { StepExecutor, WorkerTickInput } from "./engine/types.js";

export interface ExecutionWorkerLogger {
  info?(message: string, attributes?: Record<string, unknown>): void;
  error?(message: string, attributes?: Record<string, unknown>): void;
}

export interface ExecutionWorkerEngine {
  workerTick(input: WorkerTickInput): Promise<boolean>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ExecutionWorkerLoopOptions {
  engine: ExecutionWorkerEngine;
  workerId: string;
  executor: StepExecutor;
  logger?: ExecutionWorkerLogger;
  idleSleepMs?: number;
  errorSleepMs?: number;
  maxTicksPerCycle?: number;
}

export interface ExecutionWorkerLoop {
  stop: () => void;
  done: Promise<void>;
}

export function startExecutionWorkerLoop(opts: ExecutionWorkerLoopOptions): ExecutionWorkerLoop {
  const idleSleepMs = Math.max(10, Math.floor(opts.idleSleepMs ?? 250));
  const errorSleepMs = Math.max(10, Math.floor(opts.errorSleepMs ?? 1_000));
  const maxTicksPerCycle = Math.max(1, Math.floor(opts.maxTicksPerCycle ?? 25));

  let stopping = false;

  const done = (async () => {
    opts.logger?.info?.("worker.loop.started", {
      worker_id: opts.workerId,
      idle_sleep_ms: idleSleepMs,
      error_sleep_ms: errorSleepMs,
      max_ticks_per_cycle: maxTicksPerCycle,
    });

    for (;;) {
      if (stopping) break;
      try {
        let didWork = false;
        for (let i = 0; i < maxTicksPerCycle; i += 1) {
          if (stopping) break;
          const worked = await opts.engine.workerTick({
            workerId: opts.workerId,
            executor: opts.executor,
          });
          if (!worked) break;
          didWork = true;
        }

        if (stopping) break;
        if (!didWork) {
          await sleep(idleSleepMs);
        } else {
          // Yield to avoid starving the event loop under heavy load.
          await sleep(0);
        }
      } catch (err) {
        const runIdRaw =
          err && typeof err === "object"
            ? ((err as { turn_id?: unknown; turnId?: unknown }).turn_id ??
              (err as { turnId?: unknown }).turnId)
            : undefined;
        const turnId =
          typeof runIdRaw === "string" && runIdRaw.trim().length > 0 ? runIdRaw.trim() : undefined;
        const message = err instanceof Error ? err.message : String(err);
        opts.logger?.error?.("worker.loop.error", {
          worker_id: opts.workerId,
          turn_id: turnId,
          error: message,
        });
        await sleep(errorSleepMs);
      }
    }

    opts.logger?.info?.("worker.loop.stopped", { worker_id: opts.workerId });
  })();

  return {
    stop: () => {
      stopping = true;
    },
    done,
  };
}

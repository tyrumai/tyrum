/**
 * Execution runner — drives plan execution through the job queue.
 *
 * Accepts a successful PlanResponse, instantiates the PlanStateMachine,
 * enqueues jobs, and processes them sequentially with policy checks,
 * retries, and budget guards.
 */

import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import {
  checkPostcondition,
  type EvaluationContext,
} from "@tyrum/schemas";
import type { EventBus } from "../../event-bus.js";
import type { EventLog } from "../planner/event-log.js";
import { PlanStateMachine } from "../planner/state-machine.js";
import { evaluatePolicy } from "../policy/engine.js";
import { JobQueue, type Job } from "./job-queue.js";
import { randomUUID } from "node:crypto";

export interface ExecutionRunnerDeps {
  jobQueue: JobQueue;
  eventLog: EventLog;
  eventBus: EventBus;
}

export interface StepExecutor {
  execute(action: ActionPrimitiveT, planId: string, stepIndex: number): Promise<StepResult>;
}

export interface StepResult {
  success: boolean;
  result?: unknown;
  error?: string;
  /** Optional evidence for postcondition evaluation (http, json, dom contexts). */
  evidence?: EvaluationContext;
}

export interface RunnerOptions {
  maxJobTimeoutMs?: number;
  planTimeoutMs?: number;
}

const DEFAULT_MAX_JOB_TIMEOUT_MS = 60_000;
const DEFAULT_PLAN_TIMEOUT_MS = 5 * 60_000;

function retryBackoffMs(attempt: number): number {
  // Exponential backoff: 1s, 2s, 4s capped at 30s
  const baseMs = 1_000;
  const capMs = 30_000;
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ExecutionRunner {
  private readonly jobQueue: JobQueue;
  private readonly eventLog: EventLog;
  private readonly eventBus: EventBus;
  private readonly maxJobTimeoutMs: number;
  private readonly planTimeoutMs: number;

  private paused = new Set<string>();

  constructor(deps: ExecutionRunnerDeps, opts?: RunnerOptions) {
    this.jobQueue = deps.jobQueue;
    this.eventLog = deps.eventLog;
    this.eventBus = deps.eventBus;
    this.maxJobTimeoutMs = opts?.maxJobTimeoutMs ?? DEFAULT_MAX_JOB_TIMEOUT_MS;
    this.planTimeoutMs = opts?.planTimeoutMs ?? DEFAULT_PLAN_TIMEOUT_MS;

    this.eventBus.on("plan:failed", ({ planId }) => {
      void this.jobQueue.cancelAllForPlan(planId);
    });
  }

  /**
   * Execute a plan asynchronously. Enqueues all steps as jobs and processes them.
   *
   * @param planId - Unique plan identifier
   * @param steps - Array of action primitives to execute
   * @param stepExecutor - Executor for individual steps
   */
  async executePlan(
    planId: string,
    steps: ActionPrimitiveT[],
    stepExecutor: StepExecutor,
  ): Promise<void> {
    const machine = new PlanStateMachine(steps.length);

    // Submit for policy review
    machine.apply({ kind: "submitted_for_policy" });

    // Evaluate overall plan policy
    const policyResult = evaluatePolicy({
      request_id: planId,
      pii: { categories: [] },
      legal: { flags: [] },
    });

    if (policyResult.decision === "deny") {
      const detail = policyResult.rules
        .filter((r: { outcome: string }) => r.outcome === "deny")
        .map((r: { detail: string }) => r.detail)
        .join("; ");
      machine.apply({ kind: "policy_denied", detail });
      this.eventBus.emit("plan:failed", { planId, reason: "policy_denied" });
      await this.logEvent(planId, 0, { event: "policy_denied", detail });
      return;
    }

    machine.apply({ kind: "policy_approved" });

    // Enqueue all steps as jobs
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const timeoutMs = Math.min(this.maxJobTimeoutMs, DEFAULT_MAX_JOB_TIMEOUT_MS);
      await this.jobQueue.enqueue(planId, i, step, { timeoutMs });
    }

    // Process jobs sequentially
    const startedAt = Date.now();

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      // Check plan timeout
      if (Date.now() - startedAt > this.planTimeoutMs) {
        machine.apply({
          kind: "executor_failed",
          stepIndex,
          detail: "plan timeout exceeded",
        });
        await this.jobQueue.cancelAllForPlan(planId);
        this.eventBus.emit("plan:failed", { planId, reason: "plan_timeout" });
        await this.logEvent(planId, stepIndex, { event: "plan_timeout" });
        return;
      }

      // Check if plan is paused
      if (this.paused.has(planId)) {
        const job = await this.jobQueue.dequeue(planId);
        if (job) {
          await this.jobQueue.markPaused(job.id);
        }
        await this.logEvent(planId, stepIndex, { event: "paused" });
        return;
      }

      const status = machine.status;
      if (status.kind !== "ready") {
        break;
      }

      const job = await this.jobQueue.dequeue(planId);
      if (!job) {
        break;
      }

      const stepResult = await this.executeJobWithRetry(
        job,
        machine,
        stepIndex,
        planId,
        stepExecutor,
      );

      if (!stepResult) {
        // Job failed after all retries
        return;
      }
    }

    // Check final state
    if (machine.status.kind === "succeeded") {
      this.eventBus.emit("plan:completed", {
        planId,
        stepsExecuted: steps.length,
      });
      if (steps.length > 0) {
        await this.logEvent(planId, steps.length - 1, {
          event: "plan_completed",
          stepsExecuted: steps.length,
        });
      }
    }
  }

  private async executeJobWithRetry(
    job: Job,
    machine: PlanStateMachine,
    stepIndex: number,
    planId: string,
    stepExecutor: StepExecutor,
  ): Promise<boolean> {
    // Dispatch the step in the state machine (only on first attempt)
    machine.apply({ kind: "step_dispatched", stepIndex });

    // Attempt execution loop — retries happen within the same
    // awaiting_postcondition state since the PlanStateMachine does
    // not model per-attempt transitions.
    let currentJob = job;
    for (;;) {
      const result = await this.executeWithTimeout(
        stepExecutor,
        currentJob.action,
        planId,
        stepIndex,
        currentJob.timeout_ms,
      );

      if (result.success) {
        // Evaluate postcondition if the action defines one
        const postconditionResult = checkPostcondition(
          currentJob.action.postcondition,
          result.evidence ?? {},
        );

        if (!postconditionResult.passed) {
          // Treat postcondition failure as a step failure
          const errorDetail = postconditionResult.error ?? "postcondition failed";
          await this.jobQueue.markFailed(currentJob.id, errorDetail);
          await this.logEvent(planId, stepIndex, {
            event: "postcondition_failed",
            error: errorDetail,
          });

          // Try retry on postcondition failure
          const canRetry = await this.jobQueue.retryIfPossible(currentJob.id);
          if (canRetry) {
            const retryJob = await this.jobQueue.getById(currentJob.id);
            if (retryJob) {
              const backoff = retryBackoffMs(retryJob.attempt);
              await this.logEvent(planId, stepIndex, {
                event: "retry",
                attempt: retryJob.attempt,
                backoffMs: backoff,
              });
              await sleep(backoff);
              const freshJob = await this.jobQueue.dequeueById(currentJob.id);
              if (freshJob) {
                currentJob = freshJob;
                continue;
              }
            }
          }

          // Postcondition retries exhausted
          machine.apply({
            kind: "executor_failed",
            stepIndex,
            detail: errorDetail,
          });
          this.eventBus.emit("plan:failed", { planId, reason: "postcondition_failed" });
          await this.logEvent(planId, stepIndex, {
            event: "step_failed",
            error: errorDetail,
          });
          return false;
        }

        await this.jobQueue.markCompleted(currentJob.id, result.result);
        machine.apply({ kind: "postcondition_satisfied", stepIndex });
        await this.logEvent(planId, stepIndex, {
          event: "step_completed",
          result: result.result,
        });
        return true;
      }

      // Step failed
      const errorDetail = result.error ?? "unknown error";
      await this.jobQueue.markFailed(currentJob.id, errorDetail);

      // Try retry
      const canRetry = await this.jobQueue.retryIfPossible(currentJob.id);
      if (canRetry) {
        const retryJob = await this.jobQueue.getById(currentJob.id);
        if (retryJob) {
          const backoff = retryBackoffMs(retryJob.attempt);
          await this.logEvent(planId, stepIndex, {
            event: "retry",
            attempt: retryJob.attempt,
            backoffMs: backoff,
          });
          await sleep(backoff);

          const freshJob = await this.jobQueue.dequeueById(currentJob.id);
          if (freshJob) {
            currentJob = freshJob;
            continue;
          }
        }
      }

      // All retries exhausted
      machine.apply({
        kind: "executor_failed",
        stepIndex,
        detail: errorDetail,
      });
      this.eventBus.emit("plan:failed", { planId, reason: "executor_failed" });
      await this.logEvent(planId, stepIndex, {
        event: "step_failed",
        error: errorDetail,
      });
      return false;
    }
  }

  private async executeWithTimeout(
    stepExecutor: StepExecutor,
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
  ): Promise<StepResult> {
    try {
      const result = await Promise.race([
        stepExecutor.execute(action, planId, stepIndex),
        sleep(timeoutMs).then((): StepResult => ({
          success: false,
          error: `job timed out after ${timeoutMs}ms`,
        })),
      ]);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Pause execution for a plan. Jobs in progress will finish but
   * no new jobs will be dequeued.
   */
  pause(planId: string): void {
    this.paused.add(planId);
  }

  /**
   * Resume a paused plan (re-trigger would need to be called externally).
   */
  resume(planId: string): void {
    this.paused.delete(planId);
  }

  private async logEvent(planId: string, stepIndex: number, action: unknown): Promise<void> {
    await this.eventLog.append({
      replayId: randomUUID(),
      planId,
      stepIndex,
      occurredAt: new Date().toISOString(),
      action,
    });
  }
}

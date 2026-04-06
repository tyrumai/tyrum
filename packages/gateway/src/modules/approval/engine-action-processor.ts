import type { TurnController } from "../agent/runtime/turn-controller.js";
import type { Logger } from "../observability/logger.js";
import { IntervalScheduler, resolvePositiveInt } from "../lifecycle/scheduler.js";
import type { WorkflowRunRunner } from "../workflow-run/runner.js";
import type { SqlDb } from "../../statestore/types.js";
import { ApprovalEngineActionDal } from "./engine-action-dal.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

const DEFAULT_TICK_MS = 250;
const DEFAULT_LEASE_TTL_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_BATCH_SIZE = 10;

export interface ApprovalEngineActionProcessorClock {
  nowMs: number;
  nowIso: string;
}

export type ApprovalEngineActionProcessorClockFn = () => ApprovalEngineActionProcessorClock;

export interface ApprovalEngineActionProcessorOptions {
  db: SqlDb;
  engine?: TurnController;
  turnController?: TurnController;
  workflowRunner?: WorkflowRunRunner;
  owner: string;
  logger?: Logger;
  tenantId?: string;
  tickMs?: number;
  leaseTtlMs?: number;
  maxAttempts?: number;
  batchSize?: number;
  keepProcessAlive?: boolean;
  clock?: ApprovalEngineActionProcessorClockFn;
}

function defaultClock(): ApprovalEngineActionProcessorClock {
  const nowMs = Date.now();
  return { nowMs, nowIso: new Date(nowMs).toISOString() };
}

export class ApprovalEngineActionProcessor {
  private readonly dal: ApprovalEngineActionDal;
  private readonly turnController?: TurnController;
  private readonly workflowRunner?: WorkflowRunRunner;
  private readonly owner: string;
  private readonly logger?: Logger;
  private readonly tenantId: string;
  private readonly leaseTtlMs: number;
  private readonly maxAttempts: number;
  private readonly batchSize: number;
  private readonly clock: ApprovalEngineActionProcessorClockFn;
  private readonly interval: IntervalScheduler;

  constructor(opts: ApprovalEngineActionProcessorOptions) {
    this.dal = new ApprovalEngineActionDal(opts.db);
    this.turnController = opts.turnController ?? opts.engine;
    this.workflowRunner = opts.workflowRunner;
    this.owner = opts.owner;
    this.logger = opts.logger;
    this.tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
    this.clock = opts.clock ?? defaultClock;
    const tickMs = resolvePositiveInt(opts.tickMs, DEFAULT_TICK_MS);
    this.leaseTtlMs = resolvePositiveInt(opts.leaseTtlMs, DEFAULT_LEASE_TTL_MS);
    this.maxAttempts = resolvePositiveInt(opts.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    this.batchSize = resolvePositiveInt(opts.batchSize, DEFAULT_BATCH_SIZE);
    const keepProcessAlive = opts.keepProcessAlive ?? false;

    this.interval = new IntervalScheduler({
      tickMs,
      keepProcessAlive,
      onTickError: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("approval.engine_action_tick_failed", {
          tenant_id: this.tenantId,
          owner: this.owner,
          error: message,
        });
      },
      tick: () => this.tickOnce(),
    });
  }

  start(): void {
    this.interval.start();
  }

  stop(): void {
    this.interval.stop();
  }

  /** Exposed for testing — runs one tick cycle. */
  async tick(): Promise<void> {
    await this.interval.tick();
  }

  private async tickOnce(): Promise<void> {
    for (let i = 0; i < this.batchSize; i += 1) {
      const { nowMs, nowIso } = this.clock();
      const action = await this.dal.claimNext({
        tenantId: this.tenantId,
        owner: this.owner,
        nowMs,
        nowIso,
        leaseTtlMs: this.leaseTtlMs,
        maxAttempts: this.maxAttempts,
      });
      if (!action) return;

      try {
        await this.executeAction(action);
        const { nowIso: finishedIso } = this.clock();
        const ok = await this.dal.markSucceeded({
          tenantId: this.tenantId,
          actionId: action.action_id,
          owner: this.owner,
          nowIso: finishedIso,
        });
        if (ok) {
          this.logger?.info("approval.engine_action_succeeded", {
            action_id: action.action_id,
            approval_id: action.approval_id,
            action_kind: action.action_kind,
            attempts: action.attempts,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const { nowIso: failedIso } = this.clock();
        const attemptExhausted = action.attempts >= this.maxAttempts;

        const updated = attemptExhausted
          ? await this.dal.markFailed({
              tenantId: this.tenantId,
              actionId: action.action_id,
              owner: this.owner,
              nowIso: failedIso,
              error: message,
            })
          : await this.dal.requeueWithError({
              tenantId: this.tenantId,
              actionId: action.action_id,
              owner: this.owner,
              nowIso: failedIso,
              error: message,
            });

        if (updated) {
          this.logger?.warn(
            attemptExhausted ? "approval.engine_action_failed" : "approval.engine_action_retry",
            {
              action_id: action.action_id,
              approval_id: action.approval_id,
              action_kind: action.action_kind,
              attempts: action.attempts,
              error: message,
            },
          );
        }
      }
    }
  }

  private async executeAction(action: {
    approval_id: string;
    action_kind: "resume_turn" | "cancel_turn";
    resume_token: string | null;
    turn_id: string | null;
    workflow_run_id: string | null;
    reason: string | null;
  }): Promise<void> {
    if (action.action_kind === "resume_turn") {
      const token = action.resume_token?.trim();
      if (!token) {
        throw new Error("resume_turn action missing resume_token");
      }
      const workflowRunId = this.workflowRunner
        ? await this.workflowRunner.resumeRun(token)
        : undefined;
      if (workflowRunId !== undefined) {
        return;
      }
      if (!this.turnController) {
        throw new Error(
          `resume_turn action '${action.approval_id}' has no conversation-turn controller`,
        );
      }
      await this.turnController.resumeTurn(token);
      return;
    }

    const workflowRunId = action.workflow_run_id?.trim();
    if (workflowRunId && this.workflowRunner) {
      await this.workflowRunner.cancelRun(workflowRunId, action.reason ?? undefined);
      return;
    }

    const turnId = action.turn_id?.trim();
    if (!turnId) {
      throw new Error("cancel_turn action missing turn_id and workflow_run_id");
    }
    if (!this.turnController) {
      throw new Error(
        `cancel_turn action '${action.approval_id}' has no conversation-turn controller`,
      );
    }
    await this.turnController.cancelTurn(turnId, action.reason ?? undefined);
  }
}

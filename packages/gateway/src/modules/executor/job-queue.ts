/**
 * SQLite-backed job queue for plan step execution.
 *
 * Job lifecycle: pending -> running -> completed | failed | paused | cancelled
 */

import { randomUUID } from "node:crypto";
import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../identity/scope.js";
import { PlanDal } from "../planner/plan-dal.js";

export type JobStatus = "pending" | "running" | "completed" | "failed" | "paused" | "cancelled";

export interface Job {
  id: string;
  plan_id: string;
  step_index: number;
  action: ActionPrimitiveT;
  status: JobStatus;
  attempt: number;
  max_attempts: number;
  timeout_ms: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  result: unknown;
}

interface JobRow {
  id: string;
  plan_id: string;
  step_index: number;
  action_json: string;
  status: string;
  attempt: number;
  max_attempts: number;
  timeout_ms: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  result_json: string | null;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    plan_id: row.plan_id,
    step_index: row.step_index,
    action: JSON.parse(row.action_json) as ActionPrimitiveT,
    status: row.status as JobStatus,
    attempt: row.attempt,
    max_attempts: row.max_attempts,
    timeout_ms: row.timeout_ms,
    created_at: row.created_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    error: row.error,
    result: row.result_json ? (JSON.parse(row.result_json) as unknown) : null,
  };
}

export class JobQueue {
  constructor(
    private readonly db: SqlDb,
    private readonly opts?: {
      tenantId?: string;
    },
  ) {}

  private tenantId(): string {
    return this.opts?.tenantId ?? DEFAULT_TENANT_ID;
  }

  async enqueue(
    planId: string,
    stepIndex: number,
    action: ActionPrimitiveT,
    opts?: { maxAttempts?: number; timeoutMs?: number },
  ): Promise<Job> {
    const tenantId = this.tenantId();
    const id = `job-${randomUUID()}`;
    const maxAttempts = opts?.maxAttempts ?? 3;
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const actionJson = JSON.stringify(action);

    return await this.db.transaction(async (tx) => {
      await new PlanDal(tx).ensurePlanId({
        tenantId,
        planKey: planId,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        kind: "legacy_executor",
        status: "active",
      });

      await tx.run(
        `INSERT INTO jobs (
           tenant_id,
           id,
           plan_id,
           step_index,
           action_json,
           status,
           attempt,
           max_attempts,
           timeout_ms
         )
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
        [tenantId, id, planId, stepIndex, actionJson, maxAttempts, timeoutMs],
      );

      const created = await tx.get<JobRow>("SELECT * FROM jobs WHERE tenant_id = ? AND id = ?", [
        tenantId,
        id,
      ]);
      if (!created) {
        throw new Error(`failed to create job '${id}'`);
      }
      return rowToJob(created);
    });
  }

  async getById(id: string, tenantId: string = this.tenantId()): Promise<Job | undefined> {
    const row = await this.db.get<JobRow>("SELECT * FROM jobs WHERE tenant_id = ? AND id = ?", [
      tenantId,
      id,
    ]);
    return row ? rowToJob(row) : undefined;
  }

  async getByPlanId(planId: string, tenantId: string = this.tenantId()): Promise<Job[]> {
    const rows = await this.db.all<JobRow>(
      "SELECT * FROM jobs WHERE tenant_id = ? AND plan_id = ? ORDER BY step_index ASC",
      [tenantId, planId],
    );
    return rows.map(rowToJob);
  }

  /**
   * Dequeue the next pending job for a plan, marking it as running.
   * Uses a transaction to prevent TOCTOU races under concurrent access.
   * Returns undefined if no pending jobs remain.
   */
  async dequeue(planId: string, tenantId: string = this.tenantId()): Promise<Job | undefined> {
    const now = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const claimed = await tx.get<JobRow>(
        `UPDATE jobs
         SET status = 'running', attempt = attempt + 1, started_at = ?
         WHERE id = (
           SELECT id FROM jobs
           WHERE tenant_id = ? AND plan_id = ? AND status = 'pending'
           ORDER BY step_index ASC
           LIMIT 1
         ) AND status = 'pending'
         RETURNING *`,
        [now, tenantId, planId],
      );

      return claimed ? rowToJob(claimed) : undefined;
    });
  }

  /**
   * Dequeue a specific pending job by ID, marking it as running.
   * Uses a transaction to prevent TOCTOU races.
   * Returns undefined if the job is not found or not pending.
   */
  async dequeueById(id: string, tenantId: string = this.tenantId()): Promise<Job | undefined> {
    const now = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const claimed = await tx.get<JobRow>(
        `UPDATE jobs
         SET status = 'running', attempt = attempt + 1, started_at = ?
         WHERE tenant_id = ? AND id = ? AND status = 'pending'
         RETURNING *`,
        [now, tenantId, id],
      );

      return claimed ? rowToJob(claimed) : undefined;
    });
  }

  async markCompleted(
    id: string,
    result: unknown,
    tenantId: string = this.tenantId(),
  ): Promise<void> {
    const now = new Date().toISOString();
    const resultJson = result != null ? JSON.stringify(result) : null;

    await this.db.run(
      `UPDATE jobs SET status = 'completed', completed_at = ?, result_json = ?
       WHERE tenant_id = ? AND id = ?`,
      [now, resultJson, tenantId, id],
    );
  }

  async markFailed(id: string, error: string, tenantId: string = this.tenantId()): Promise<void> {
    const now = new Date().toISOString();

    await this.db.run(
      `UPDATE jobs SET status = 'failed', completed_at = ?, error = ?
       WHERE tenant_id = ? AND id = ?`,
      [now, error, tenantId, id],
    );
  }

  async markPaused(id: string, tenantId: string = this.tenantId()): Promise<void> {
    await this.db.run("UPDATE jobs SET status = 'paused' WHERE tenant_id = ? AND id = ?", [
      tenantId,
      id,
    ]);
  }

  async markCancelled(id: string, tenantId: string = this.tenantId()): Promise<void> {
    const now = new Date().toISOString();

    await this.db.run(
      `UPDATE jobs SET status = 'cancelled', completed_at = ?
       WHERE tenant_id = ? AND id = ?`,
      [now, tenantId, id],
    );
  }

  /**
   * Reset a failed job back to pending for retry, if it has attempts remaining.
   * Returns true if the job was reset, false if max attempts reached.
   */
  async retryIfPossible(id: string, tenantId: string = this.tenantId()): Promise<boolean> {
    const job = await this.getById(id, tenantId);
    if (!job) return false;

    if (job.attempt >= job.max_attempts) return false;

    await this.db.run(
      `UPDATE jobs SET status = 'pending', error = NULL, started_at = NULL
       WHERE tenant_id = ? AND id = ?`,
      [tenantId, id],
    );

    return true;
  }

  /**
   * Cancel all pending/running jobs for a plan.
   */
  async cancelAllForPlan(planId: string, tenantId: string = this.tenantId()): Promise<void> {
    const now = new Date().toISOString();

    await this.db.run(
      `UPDATE jobs SET status = 'cancelled', completed_at = ?
       WHERE tenant_id = ? AND plan_id = ? AND status IN ('pending', 'running')`,
      [now, tenantId, planId],
    );
  }
}

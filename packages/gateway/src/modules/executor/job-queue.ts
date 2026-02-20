/**
 * SQLite-backed job queue for plan step execution.
 *
 * Job lifecycle: pending -> running -> completed | failed | paused | cancelled
 */

import { randomUUID } from "node:crypto";
import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

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
  constructor(private readonly db: SqlDb) {}

  async enqueue(
    planId: string,
    stepIndex: number,
    action: ActionPrimitiveT,
    opts?: { maxAttempts?: number; timeoutMs?: number },
  ): Promise<Job> {
    const id = `job-${randomUUID()}`;
    const maxAttempts = opts?.maxAttempts ?? 3;
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const actionJson = JSON.stringify(action);

    await this.db.run(
      `INSERT INTO jobs (id, plan_id, step_index, action_json, status, attempt, max_attempts, timeout_ms)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
      [id, planId, stepIndex, actionJson, maxAttempts, timeoutMs],
    );

    const created = await this.getById(id);
    if (!created) {
      throw new Error(`failed to create job '${id}'`);
    }
    return created;
  }

  async getById(id: string): Promise<Job | undefined> {
    const row = await this.db.get<JobRow>("SELECT * FROM jobs WHERE id = ?", [id]);
    return row ? rowToJob(row) : undefined;
  }

  async getByPlanId(planId: string): Promise<Job[]> {
    const rows = await this.db.all<JobRow>(
      "SELECT * FROM jobs WHERE plan_id = ? ORDER BY step_index ASC",
      [planId],
    );
    return rows.map(rowToJob);
  }

  /**
   * Dequeue the next pending job for a plan, marking it as running.
   * Uses a transaction to prevent TOCTOU races under concurrent access.
   * Returns undefined if no pending jobs remain.
   */
  async dequeue(planId: string): Promise<Job | undefined> {
    const now = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const row = await tx.get<JobRow>(
        `SELECT * FROM jobs
         WHERE plan_id = ? AND status = 'pending'
         ORDER BY step_index ASC
         LIMIT 1`,
        [planId],
      );

      if (!row) return undefined;

      await tx.run(
        `UPDATE jobs SET status = 'running', attempt = attempt + 1, started_at = ?
         WHERE id = ? AND status = 'pending'`,
        [now, row.id],
      );

      const updated = await tx.get<JobRow>("SELECT * FROM jobs WHERE id = ?", [row.id]);
      return updated ? rowToJob(updated) : undefined;
    });
  }

  /**
   * Dequeue a specific pending job by ID, marking it as running.
   * Uses a transaction to prevent TOCTOU races.
   * Returns undefined if the job is not found or not pending.
   */
  async dequeueById(id: string): Promise<Job | undefined> {
    const now = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const row = await tx.get<JobRow>(
        `SELECT * FROM jobs
         WHERE id = ? AND status = 'pending'
         LIMIT 1`,
        [id],
      );

      if (!row) return undefined;

      await tx.run(
        `UPDATE jobs SET status = 'running', attempt = attempt + 1, started_at = ?
         WHERE id = ? AND status = 'pending'`,
        [now, row.id],
      );

      const updated = await tx.get<JobRow>("SELECT * FROM jobs WHERE id = ?", [row.id]);
      return updated ? rowToJob(updated) : undefined;
    });
  }

  async markCompleted(id: string, result: unknown): Promise<void> {
    const now = new Date().toISOString();
    const resultJson = result != null ? JSON.stringify(result) : null;

    await this.db.run(
      `UPDATE jobs SET status = 'completed', completed_at = ?, result_json = ?
       WHERE id = ?`,
      [now, resultJson, id],
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db.run(
      `UPDATE jobs SET status = 'failed', completed_at = ?, error = ?
       WHERE id = ?`,
      [now, error, id],
    );
  }

  async markPaused(id: string): Promise<void> {
    await this.db.run("UPDATE jobs SET status = 'paused' WHERE id = ?", [id]);
  }

  async markCancelled(id: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db.run(
      `UPDATE jobs SET status = 'cancelled', completed_at = ?
       WHERE id = ?`,
      [now, id],
    );
  }

  /**
   * Reset a failed job back to pending for retry, if it has attempts remaining.
   * Returns true if the job was reset, false if max attempts reached.
   */
  async retryIfPossible(id: string): Promise<boolean> {
    const job = await this.getById(id);
    if (!job) return false;

    if (job.attempt >= job.max_attempts) return false;

    await this.db.run(
      `UPDATE jobs SET status = 'pending', error = NULL, started_at = NULL
       WHERE id = ?`,
      [id],
    );

    return true;
  }

  /**
   * Cancel all pending/running jobs for a plan.
   */
  async cancelAllForPlan(planId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db.run(
      `UPDATE jobs SET status = 'cancelled', completed_at = ?
       WHERE plan_id = ? AND status IN ('pending', 'running')`,
      [now, planId],
    );
  }
}

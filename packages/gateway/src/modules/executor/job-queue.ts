/**
 * SQLite-backed job queue for plan step execution.
 *
 * Job lifecycle: pending -> running -> completed | failed | paused | cancelled
 */

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";

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
  constructor(private readonly db: Database.Database) {}

  enqueue(
    planId: string,
    stepIndex: number,
    action: ActionPrimitiveT,
    opts?: { maxAttempts?: number; timeoutMs?: number },
  ): Job {
    const id = `job-${randomUUID()}`;
    const maxAttempts = opts?.maxAttempts ?? 3;
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const actionJson = JSON.stringify(action);

    this.db
      .prepare(
        `INSERT INTO jobs (id, plan_id, step_index, action_json, status, attempt, max_attempts, timeout_ms)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(id, planId, stepIndex, actionJson, maxAttempts, timeoutMs);

    return this.getById(id)!;
  }

  getById(id: string): Job | undefined {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(id) as JobRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  getByPlanId(planId: string): Job[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs WHERE plan_id = ? ORDER BY step_index ASC")
      .all(planId) as JobRow[];
    return rows.map(rowToJob);
  }

  /**
   * Dequeue the next pending job for a plan, marking it as running.
   * Uses a transaction to prevent TOCTOU races under concurrent access.
   * Returns undefined if no pending jobs remain.
   */
  dequeue(planId: string): Job | undefined {
    const now = new Date().toISOString();

    const txn = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM jobs
           WHERE plan_id = ? AND status = 'pending'
           ORDER BY step_index ASC
           LIMIT 1`,
        )
        .get(planId) as JobRow | undefined;

      if (!row) return undefined;

      this.db
        .prepare(
          `UPDATE jobs SET status = 'running', attempt = attempt + 1, started_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(now, row.id);

      return this.getById(row.id);
    });

    return txn();
  }

  markCompleted(id: string, result: unknown): void {
    const now = new Date().toISOString();
    const resultJson = result != null ? JSON.stringify(result) : null;

    this.db
      .prepare(
        `UPDATE jobs SET status = 'completed', completed_at = ?, result_json = ?
         WHERE id = ?`,
      )
      .run(now, resultJson, id);
  }

  markFailed(id: string, error: string): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE jobs SET status = 'failed', completed_at = ?, error = ?
         WHERE id = ?`,
      )
      .run(now, error, id);
  }

  markPaused(id: string): void {
    this.db
      .prepare("UPDATE jobs SET status = 'paused' WHERE id = ?")
      .run(id);
  }

  markCancelled(id: string): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE jobs SET status = 'cancelled', completed_at = ?
         WHERE id = ?`,
      )
      .run(now, id);
  }

  /**
   * Reset a failed job back to pending for retry, if it has attempts remaining.
   * Returns true if the job was reset, false if max attempts reached.
   */
  retryIfPossible(id: string): boolean {
    const job = this.getById(id);
    if (!job) return false;

    if (job.attempt >= job.max_attempts) return false;

    this.db
      .prepare(
        `UPDATE jobs SET status = 'pending', error = NULL, started_at = NULL
         WHERE id = ?`,
      )
      .run(id);

    return true;
  }

  /**
   * Cancel all pending/running jobs for a plan.
   */
  cancelAllForPlan(planId: string): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE jobs SET status = 'cancelled', completed_at = ?
         WHERE plan_id = ? AND status IN ('pending', 'running')`,
      )
      .run(now, planId);
  }
}

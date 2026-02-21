/**
 * Durable playbook runner.
 *
 * Wraps the existing PlaybookRunner and routes playbook execution through
 * the durable execution engine by inserting into execution_jobs,
 * execution_runs, and execution_steps tables.
 */

import type { Playbook } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { PlaybookRunner } from "./runner.js";
import { randomUUID } from "node:crypto";

export interface DurablePlaybookRunResult {
  playbook_id: string;
  job_id: string;
  run_id: string;
  step_count: number;
  created_at: string;
}

export class DurablePlaybookRunner {
  private readonly runner: PlaybookRunner;

  constructor(
    private readonly db: SqlDb,
    runner?: PlaybookRunner,
  ) {
    this.runner = runner ?? new PlaybookRunner();
  }

  /**
   * Run a playbook through the durable execution engine.
   * Creates execution_jobs, execution_runs, and execution_steps entries.
   */
  async runDurable(playbook: Playbook, requestId?: string): Promise<DurablePlaybookRunResult> {
    const result = this.runner.run(playbook);
    const jobId = randomUUID();
    const runId = randomUUID();
    const lane = "playbook";
    const key = `playbook:${playbook.manifest.id}`;
    const reqId = requestId ?? randomUUID();

    const triggerJson = JSON.stringify({
      kind: "playbook",
      metadata: {
        playbook_id: playbook.manifest.id,
        plan_id: jobId,
        request_id: reqId,
      },
    });
    const inputJson = JSON.stringify({
      playbook_id: playbook.manifest.id,
      plan_id: jobId,
      request_id: reqId,
    });

    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id)
         VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
        [jobId, key, lane, triggerJson, inputJson, runId],
      );

      await tx.run(
        `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, 'queued', 1)`,
        [runId, jobId, key, lane],
      );

      for (let i = 0; i < result.steps.length; i++) {
        const stepId = randomUUID();
        const step = result.steps[i]!;
        await tx.run(
          `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json, max_attempts, timeout_ms, idempotency_key, postcondition_json)
           VALUES (?, ?, ?, 'queued', ?, 3, 30000, ?, ?)`,
          [
            stepId,
            runId,
            i,
            JSON.stringify(step),
            step.idempotency_key ?? null,
            step.postcondition ? JSON.stringify(step.postcondition) : null,
          ],
        );
      }

      await tx.run(
        `UPDATE execution_jobs SET status = 'running' WHERE job_id = ?`,
        [jobId],
      );
    });

    return {
      playbook_id: playbook.manifest.id,
      job_id: jobId,
      run_id: runId,
      step_count: result.steps.length,
      created_at: new Date().toISOString(),
    };
  }

  /** Delegate to the non-durable runner for legacy/fire-and-forget. */
  runLegacy(playbook: Playbook) {
    return this.runner.run(playbook);
  }
}

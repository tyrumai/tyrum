/**
 * ApprovalResolver — bridges the approval queue with the execution engine.
 *
 * Listens for `approval:resolved` events on the EventBus and either
 * resumes or fails the associated paused execution run.
 */

import type { ApprovalDal } from "./dal.js";
import type { SqlDb } from "../../statestore/types.js";
import type { EventBus } from "../../event-bus.js";

export interface ApprovalResolverDeps {
  approvalDal: ApprovalDal;
  db: SqlDb;
  eventBus: EventBus;
}

export class ApprovalResolver {
  constructor(private readonly deps: ApprovalResolverDeps) {}

  /** Start listening for approval:resolved events to trigger run resume. */
  start(): void {
    this.deps.eventBus.on("approval:resolved", async (event) => {
      await this.handleResolved(event);
    });
  }

  private async handleResolved(event: {
    approvalId: number;
    approved: boolean;
    reason?: string;
  }): Promise<void> {
    const approval = await this.deps.approvalDal.getById(event.approvalId);
    if (!approval) return;

    // Check if this approval has an associated run_id and resume_token
    // (these are the new columns added by the migration)
    const row = await this.deps.db.get<{ run_id: string | null; resume_token: string | null }>(
      "SELECT run_id, resume_token FROM approvals WHERE id = ?",
      [event.approvalId],
    );
    if (!row?.run_id || !row?.resume_token) return;

    if (event.approved) {
      // Resume the paused run
      const nowIso = new Date().toISOString();
      await this.deps.db.transaction(async (tx) => {
        await tx.run(
          "UPDATE resume_tokens SET revoked_at = ? WHERE token = ?",
          [nowIso, row.resume_token],
        );
        await tx.run(
          "UPDATE execution_runs SET status = 'queued', paused_reason = NULL, paused_detail = NULL WHERE run_id = ? AND status = 'paused'",
          [row.run_id],
        );
        await tx.run(
          "UPDATE execution_steps SET status = 'queued' WHERE run_id = ? AND status = 'paused'",
          [row.run_id],
        );
      });
    } else {
      // Approval denied — fail the run
      const nowIso = new Date().toISOString();
      await this.deps.db.run(
        "UPDATE execution_runs SET status = 'failed', finished_at = ? WHERE run_id = ? AND status = 'paused'",
        [nowIso, row.run_id],
      );
    }
  }

  /** Create an approval linked to an execution run, pausing the run. */
  async createExecutionApproval(params: {
    runId: string;
    stepId: string;
    attemptId?: string;
    prompt: string;
    context?: unknown;
    resumeToken: string;
    expiresAt?: string;
  }): Promise<void> {
    // Create approval with execution context
    const approval = await this.deps.approvalDal.create({
      planId: params.runId,
      stepIndex: 0,
      prompt: params.prompt,
      context: params.context,
      expiresAt: params.expiresAt,
    });

    // Link the approval to the execution run
    await this.deps.db.run(
      "UPDATE approvals SET run_id = ?, step_id = ?, attempt_id = ?, resume_token = ? WHERE id = ?",
      [params.runId, params.stepId, params.attemptId ?? null, params.resumeToken, approval.id],
    );

    // Pause the run
    await this.deps.db.run(
      "UPDATE execution_runs SET status = 'paused', paused_reason = 'approval', paused_detail = ? WHERE run_id = ?",
      [JSON.stringify({ approval_id: approval.id }), params.runId],
    );
  }
}

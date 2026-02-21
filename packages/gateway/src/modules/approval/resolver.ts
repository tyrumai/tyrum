/**
 * ApprovalResolver — bridges the approval queue with the execution engine.
 *
 * Listens for `approval:resolved` events on the EventBus and either
 * resumes or fails the associated paused execution run.
 */

import type { ApprovalDal } from "./dal.js";
import type { SqlDb } from "../../statestore/types.js";
import type { EventBus } from "../../event-bus.js";
import type { EventPublisher } from "../backplane/event-publisher.js";
import { sendApprovalUpdate, type ProtocolDeps } from "../../ws/protocol.js";

export interface ApprovalResolverDeps {
  approvalDal: ApprovalDal;
  db: SqlDb;
  eventBus: EventBus;
  eventPublisher?: EventPublisher;
  protocolDeps?: ProtocolDeps;
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

    if (!approval.run_id || !approval.resume_token) return;
    const row = { run_id: approval.run_id, resume_token: approval.resume_token };

    // Publish durable event
    void this.deps.eventPublisher?.publish("approval.resolved", {
      approval_id: event.approvalId,
      approved: event.approved,
      reason: event.reason,
      run_id: row.run_id,
    }).catch(() => { /* best-effort */ });

    if (this.deps.protocolDeps) {
      sendApprovalUpdate("approval.resolved", {
        approval_id: event.approvalId,
        approved: event.approved,
        reason: event.reason,
        run_id: row.run_id,
      }, this.deps.protocolDeps);
    }

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
      await this.deps.db.transaction(async (tx) => {
        await tx.run(
          "UPDATE resume_tokens SET revoked_at = ? WHERE token = ?",
          [nowIso, row.resume_token],
        );
        await tx.run(
          "UPDATE execution_runs SET status = 'failed', finished_at = ? WHERE run_id = ? AND status = 'paused'",
          [nowIso, row.run_id],
        );
        await tx.run(
          "UPDATE execution_steps SET status = 'failed' WHERE run_id = ? AND status = 'paused'",
          [row.run_id],
        );
      });
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
    // Create approval with all execution columns in a single insert
    const approval = await this.deps.approvalDal.create({
      planId: params.runId,
      stepIndex: 0,
      prompt: params.prompt,
      context: params.context,
      expiresAt: params.expiresAt,
      runId: params.runId,
      stepId: params.stepId,
      attemptId: params.attemptId,
      resumeToken: params.resumeToken,
    });

    // Pause the run
    await this.deps.db.run(
      "UPDATE execution_runs SET status = 'paused', paused_reason = 'approval', paused_detail = ? WHERE run_id = ?",
      [JSON.stringify({ approval_id: approval.id }), params.runId],
    );

    // Publish durable event
    void this.deps.eventPublisher?.publish("approval.requested", {
      approval_id: approval.id,
      run_id: params.runId,
      step_id: params.stepId,
      prompt: params.prompt,
    }).catch(() => { /* best-effort */ });

    if (this.deps.protocolDeps) {
      sendApprovalUpdate("approval.pending", {
        approval_id: approval.id,
        plan_id: params.runId,
        step_index: 0,
        prompt: params.prompt,
        run_id: params.runId,
      }, this.deps.protocolDeps);
    }
  }
}

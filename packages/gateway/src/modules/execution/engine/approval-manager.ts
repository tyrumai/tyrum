import type {
  ActionPrimitive as ActionPrimitiveT,
  WsEventEnvelope as WsEventEnvelopeT,
  WsRequestEnvelope as WsRequestEnvelopeT,
} from "@tyrum/schemas";
import { requiresPostcondition } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { Logger } from "../../observability/logger.js";
import type { SqlDb } from "../../../statestore/types.js";
import { APPROVAL_WS_AUDIENCE } from "../../../ws/audience.js";
import { ApprovalDal } from "../../approval/dal.js";
import { toApprovalContract } from "../../approval/to-contract.js";
import { releaseLaneAndWorkspaceLeasesTx } from "./concurrency-manager.js";
import { parsePlanIdFromTriggerJson } from "./db.js";
import type { ExecutionEngineEventEmitter } from "./event-emitter.js";
import type { ClockFn } from "./types.js";

export interface PauseRunForApprovalOpts {
  tenantId: string;
  agentId: string;
  workspaceId: string;
  planId: string;
  stepIndex: number;
  runId: string;
  stepId: string;
  attemptId?: string;
  jobId: string;
  key: string;
  lane: string;
  workerId: string;
}

export interface PauseRunForApprovalInput {
  kind: string;
  prompt: string;
  detail: string;
  context?: unknown;
  expiresAt?: string | null;
}

export type MaybeRetryOrFailStepOpts = {
  tx: SqlDb;
  nowIso: string;
  tenantId: string;
  agentId: string;
  attemptNum: number;
  maxAttempts: number;
  stepId: string;
  attemptId?: string;
  runId: string;
  jobId: string;
  workspaceId: string;
  key: string;
  lane: string;
  workerId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class ExecutionEngineApprovalManager {
  constructor(
    private readonly opts: {
      clock: ClockFn;
      logger?: Logger;
      redactText: (text: string) => string;
      redactUnknown: (value: unknown) => unknown;
      eventEmitter: Pick<
        ExecutionEngineEventEmitter,
        | "emitRunUpdatedTx"
        | "emitStepUpdatedTx"
        | "emitRunPausedTx"
        | "emitRunIdEventTx"
        | "enqueueWsEvent"
        | "enqueueWsMessage"
      >;
    },
  ) {}

  async maybeRetryOrFailStep(opts: MaybeRetryOrFailStepOpts): Promise<boolean> {
    const tx = opts.tx;
    const maxAttempts = Math.max(1, opts.maxAttempts);
    if (opts.attemptNum < maxAttempts) {
      const step = await tx.get<{
        idempotency_key: string | null;
        action_json: string;
        step_index: number;
      }>(
        `SELECT idempotency_key, action_json, step_index
         FROM execution_steps
         WHERE tenant_id = ? AND step_id = ?`,
        [opts.tenantId, opts.stepId],
      );

      const idempotencyKey = step?.idempotency_key?.trim() ?? "";
      let actionType: ActionPrimitiveT["type"] | undefined;
      try {
        const parsed = JSON.parse(step?.action_json ?? "{}") as { type?: unknown };
        if (typeof parsed?.type === "string") {
          actionType = parsed.type as ActionPrimitiveT["type"];
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.opts.logger?.warn("execution.step_action_parse_failed", {
          run_id: opts.runId,
          step_id: opts.stepId,
          attempt_id: opts.attemptId,
          error: message,
        });
      }

      const isStateChanging = actionType ? requiresPostcondition(actionType) : true;
      const autoRetryAllowed = idempotencyKey.length > 0 || !isStateChanging;

      if (autoRetryAllowed) {
        await tx.run(
          `UPDATE execution_steps
           SET status = 'queued'
           WHERE tenant_id = ? AND step_id = ? AND status = 'running'`,
          [opts.tenantId, opts.stepId],
        );
        await this.opts.eventEmitter.emitStepUpdatedTx(tx, opts.stepId);
        return true;
      }

      const job = await tx.get<{ trigger_json: string }>(
        "SELECT trigger_json FROM execution_jobs WHERE tenant_id = ? AND job_id = ?",
        [opts.tenantId, opts.jobId],
      );
      const planId =
        (job?.trigger_json ? parsePlanIdFromTriggerJson(job.trigger_json) : undefined) ??
        opts.runId;

      await this.pauseRunForApproval(
        tx,
        {
          tenantId: opts.tenantId,
          agentId: opts.agentId,
          workspaceId: opts.workspaceId,
          planId,
          stepIndex: step?.step_index ?? 0,
          runId: opts.runId,
          jobId: opts.jobId,
          stepId: opts.stepId,
          attemptId: opts.attemptId,
          key: opts.key,
          lane: opts.lane,
          workerId: opts.workerId,
        },
        {
          kind: "retry",
          prompt: "Retry required — step is not idempotent",
          detail:
            "Step failed and is state-changing without an idempotency_key; automatic retries are disabled. Approve to retry.",
          context: {
            action_type: actionType,
            attempt: opts.attemptNum,
            max_attempts: maxAttempts,
          },
        },
      );

      return true;
    }

    await tx.run(
      `UPDATE execution_steps
       SET status = 'failed'
       WHERE tenant_id = ? AND step_id = ? AND status = 'running'`,
      [opts.tenantId, opts.stepId],
    );
    await this.opts.eventEmitter.emitStepUpdatedTx(tx, opts.stepId);

    await tx.run(
      `UPDATE execution_steps
       SET status = 'cancelled'
       WHERE tenant_id = ? AND run_id = ? AND status = 'queued'`,
      [opts.tenantId, opts.runId],
    );

    const runUpdated = await tx.run(
      `UPDATE execution_runs
       SET status = 'failed', finished_at = ?
       WHERE tenant_id = ? AND run_id = ? AND status != 'cancelled'`,
      [opts.nowIso, opts.tenantId, opts.runId],
    );

    await tx.run(
      `UPDATE execution_jobs
       SET status = 'failed'
       WHERE tenant_id = ? AND job_id = ? AND status != 'cancelled'`,
      [opts.tenantId, opts.jobId],
    );

    if (runUpdated.changes === 1) {
      await this.opts.eventEmitter.emitRunUpdatedTx(tx, opts.runId);
      await this.opts.eventEmitter.emitRunIdEventTx(tx, "run.failed", opts.runId);
    }
    await releaseLaneAndWorkspaceLeasesTx(tx, {
      tenantId: opts.tenantId,
      key: opts.key,
      lane: opts.lane,
      workspaceId: opts.workspaceId,
      owner: opts.workerId,
    });

    return true;
  }

  async pauseRunForApproval(
    tx: SqlDb,
    opts: PauseRunForApprovalOpts,
    input: PauseRunForApprovalInput,
  ): Promise<{ approvalId: string; resumeToken: string }> {
    const nowIso = this.opts.clock().nowIso;
    const expiresAt =
      input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const pausedReason =
      input.kind === "takeover"
        ? "takeover"
        : input.kind === "budget"
          ? "budget"
          : input.kind === "policy"
            ? "policy"
            : "approval";
    const pausedDetail = this.opts.redactText(input.detail);

    const runUpdated = await tx.run(
      `UPDATE execution_runs
       SET status = 'paused', paused_reason = ?, paused_detail = ?
       WHERE tenant_id = ? AND run_id = ? AND status IN ('running', 'queued')`,
      [pausedReason, pausedDetail, opts.tenantId, opts.runId],
    );
    if (runUpdated.changes !== 1) {
      const current = await tx.get<{ status: string }>(
        "SELECT status FROM execution_runs WHERE tenant_id = ? AND run_id = ?",
        [opts.tenantId, opts.runId],
      );
      if (current?.status !== "paused") {
        throw new Error(`failed to pause run ${opts.runId}`);
      }
    }

    const approvalKeyBase = `exec:${opts.runId}:${opts.stepId}`;
    const approvalKey = (() => {
      if (input.kind === "policy") {
        return `${approvalKeyBase}:step:${String(opts.stepIndex)}:policy`;
      }
      if (input.kind === "budget") {
        return `exec:${opts.runId}:budget`;
      }
      if (opts.attemptId) {
        return `${approvalKeyBase}:attempt:${opts.attemptId}:${input.kind}`;
      }
      return `${approvalKeyBase}:${input.kind}`;
    })();

    const approvalDal = new ApprovalDal(tx);
    let approval = await approvalDal.getByKey({ tenantId: opts.tenantId, approvalKey });
    let resumeToken = approval?.resume_token?.trim() ?? "";

    if (!approval || approval.status !== "pending") {
      const suffix = approval && approval.status !== "pending" ? `:${randomUUID()}` : "";
      const approvalKeyToCreate = suffix ? `${approvalKey}${suffix}` : approvalKey;
      resumeToken = `resume-${randomUUID()}`;

      await tx.run(
        `INSERT INTO resume_tokens (tenant_id, token, run_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (tenant_id, token) DO NOTHING`,
        [opts.tenantId, resumeToken, opts.runId, nowIso],
      );

      const baseContext: Record<string, unknown> = {
        ...(isRecord(input.context) ? input.context : {}),
        resume_token: resumeToken,
        key: opts.key,
        lane: opts.lane,
        plan_id: opts.planId,
        step_index: opts.stepIndex,
        run_id: opts.runId,
        job_id: opts.jobId,
        step_id: opts.stepId,
        ...(opts.attemptId ? { attempt_id: opts.attemptId } : {}),
        paused_reason: pausedReason,
        paused_detail: input.detail,
      };
      const contextToPersist = this.opts.redactUnknown(baseContext);

      approval = await approvalDal.create({
        tenantId: opts.tenantId,
        agentId: opts.agentId,
        workspaceId: opts.workspaceId,
        approvalKey: approvalKeyToCreate,
        prompt: input.prompt,
        kind: input.kind,
        context: contextToPersist,
        expiresAt,
        runId: opts.runId,
        stepId: opts.stepId,
        attemptId: opts.attemptId ?? null,
        resumeToken,
      });
    } else {
      if (!resumeToken) {
        resumeToken = `resume-${randomUUID()}`;
        await tx.run(
          `UPDATE approvals
           SET resume_token = ?
           WHERE tenant_id = ? AND approval_id = ? AND resume_token IS NULL`,
          [resumeToken, opts.tenantId, approval.approval_id],
        );
      }

      if (resumeToken) {
        await tx.run(
          `INSERT INTO resume_tokens (tenant_id, token, run_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (tenant_id, token) DO NOTHING`,
          [opts.tenantId, resumeToken, opts.runId, nowIso],
        );
      }
    }

    const stepUpdated = await tx.run(
      `UPDATE execution_steps
       SET status = 'paused', approval_id = COALESCE(approval_id, ?)
       WHERE tenant_id = ? AND step_id = ? AND status IN ('running', 'queued')`,
      [approval.approval_id, opts.tenantId, opts.stepId],
    );
    if (stepUpdated.changes !== 1) {
      const current = await tx.get<{ status: string }>(
        "SELECT status FROM execution_steps WHERE tenant_id = ? AND step_id = ?",
        [opts.tenantId, opts.stepId],
      );
      if (current?.status !== "paused") {
        throw new Error(`failed to pause step ${opts.stepId}`);
      }
    }
    await tx.run(
      `UPDATE execution_steps
       SET approval_id = COALESCE(approval_id, ?)
       WHERE tenant_id = ? AND step_id = ? AND status = 'paused'`,
      [approval.approval_id, opts.tenantId, opts.stepId],
    );

    await releaseLaneAndWorkspaceLeasesTx(tx, {
      tenantId: opts.tenantId,
      key: opts.key,
      lane: opts.lane,
      workspaceId: opts.workspaceId,
      owner: opts.workerId,
    });

    await this.opts.eventEmitter.emitRunUpdatedTx(tx, opts.runId);
    await this.opts.eventEmitter.emitStepUpdatedTx(tx, opts.stepId);
    await this.opts.eventEmitter.emitRunPausedTx(tx, {
      runId: opts.runId,
      reason: pausedReason,
      approvalId: approval.approval_id,
      detail: pausedDetail,
    });

    const approvalContract = toApprovalContract(approval);
    if (approvalContract) {
      const approvalRequestedEvt: WsEventEnvelopeT = {
        event_id: randomUUID(),
        type: "approval.requested",
        occurred_at: nowIso,
        scope: { kind: "run", run_id: opts.runId },
        payload: { approval: approvalContract },
      };
      await this.opts.eventEmitter.enqueueWsEvent(
        tx,
        opts.tenantId,
        approvalRequestedEvt,
        APPROVAL_WS_AUDIENCE,
      );
    }

    const approvalRequest: WsRequestEnvelopeT = {
      request_id: `approval-${approval.approval_id}`,
      type: "approval.request",
      payload: {
        approval_id: approval.approval_id,
        approval_key: approval.approval_key,
        kind: approval.kind,
        prompt: approval.prompt,
        context: approval.context,
        expires_at: approval.expires_at,
      },
    };
    await this.opts.eventEmitter.enqueueWsMessage(
      tx,
      opts.tenantId,
      approvalRequest,
      APPROVAL_WS_AUDIENCE,
    );

    return { approvalId: approval.approval_id, resumeToken };
  }
}

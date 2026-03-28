import type {
  ActionPrimitive as ActionPrimitiveT,
  WsEventEnvelope as WsEventEnvelopeT,
  WsRequestEnvelope as WsRequestEnvelopeT,
} from "@tyrum/contracts";
import { requiresPostcondition } from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { WsBroadcastAudience } from "../../../ws/audience.js";
import type { Logger } from "../../observability/logger.js";
import type { SqlDb } from "../../../statestore/types.js";
import { APPROVAL_WS_AUDIENCE } from "../../../ws/audience.js";
import { ApprovalDal } from "../../approval/dal.js";
import { toApprovalContract } from "../../approval/to-contract.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { createReviewedApproval } from "../../review/review-init.js";
import { DesktopEnvironmentDal } from "../../desktop-environments/dal.js";
import { enrichApprovalWithManagedDesktop } from "../../desktop-environments/managed-desktop-reference.js";
import type {
  ClockFn,
  ExecutionApprovalPort,
  ExecutionEventPort,
  ExecutionMaybeRetryOrFailStepOptions,
  ExecutionPauseRunForApprovalInput,
  ExecutionPauseRunForApprovalOptions,
} from "./types.js";
import { releaseConversationAndWorkspaceLeasesTx } from "./concurrency-manager.js";
import { parsePlanIdFromTriggerJson } from "./db.js";
export type PauseRunForApprovalOpts = ExecutionPauseRunForApprovalOptions;
export type PauseRunForApprovalInput = ExecutionPauseRunForApprovalInput;
export type MaybeRetryOrFailStepOpts = ExecutionMaybeRetryOrFailStepOptions<SqlDb>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class ExecutionEngineApprovalManager implements ExecutionApprovalPort<SqlDb> {
  constructor(
    private readonly opts: {
      clock: ClockFn;
      logger?: Logger;
      policyService?: PolicyService;
      redactText: (text: string) => string;
      redactUnknown: (value: unknown) => unknown;
      eventEmitter: Pick<
        ExecutionEventPort<
          SqlDb,
          WsEventEnvelopeT,
          WsEventEnvelopeT | WsRequestEnvelopeT,
          WsBroadcastAudience
        >,
        | "emitTurnUpdatedTx"
        | "emitStepUpdatedTx"
        | "emitTurnBlockedTx"
        | "emitTurnLifecycleEventTx"
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
          turn_id: opts.turnId,
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
        "SELECT trigger_json FROM turn_jobs WHERE tenant_id = ? AND job_id = ?",
        [opts.tenantId, opts.jobId],
      );
      const planId =
        (job?.trigger_json ? parsePlanIdFromTriggerJson(job.trigger_json) : undefined) ??
        opts.turnId;

      await this.pauseRunForApproval(
        tx,
        {
          tenantId: opts.tenantId,
          agentId: opts.agentId,
          workspaceId: opts.workspaceId,
          planId,
          stepIndex: step?.step_index ?? 0,
          turnId: opts.turnId,
          jobId: opts.jobId,
          stepId: opts.stepId,
          attemptId: opts.attemptId,
          key: opts.key,
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
       WHERE tenant_id = ? AND turn_id = ? AND status = 'queued'`,
      [opts.tenantId, opts.turnId],
    );

    const runUpdated = await tx.run(
      `UPDATE turns
       SET status = 'failed', finished_at = ?
       WHERE tenant_id = ? AND turn_id = ? AND status != 'cancelled'`,
      [opts.nowIso, opts.tenantId, opts.turnId],
    );

    await tx.run(
      `UPDATE turn_jobs
       SET status = 'failed'
       WHERE tenant_id = ? AND job_id = ? AND status != 'cancelled'`,
      [opts.tenantId, opts.jobId],
    );

    if (runUpdated.changes === 1) {
      await this.opts.eventEmitter.emitTurnUpdatedTx(tx, opts.turnId);
      await this.opts.eventEmitter.emitTurnLifecycleEventTx(tx, "turn.failed", opts.turnId);
    }
    await releaseConversationAndWorkspaceLeasesTx(tx, {
      tenantId: opts.tenantId,
      key: opts.key,
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
      `UPDATE turns
       SET status = 'paused', blocked_reason = ?, blocked_detail = ?
       WHERE tenant_id = ? AND turn_id = ? AND status IN ('running', 'queued')`,
      [pausedReason, pausedDetail, opts.tenantId, opts.turnId],
    );
    if (runUpdated.changes !== 1) {
      const current = await tx.get<{ status: string }>(
        "SELECT status FROM turns WHERE tenant_id = ? AND turn_id = ?",
        [opts.tenantId, opts.turnId],
      );
      if (current?.status !== "paused") {
        throw new Error(`failed to pause run ${opts.turnId}`);
      }
    }

    const approvalKeyBase = `exec:${opts.turnId}:${opts.stepId}`;
    const approvalKey = (() => {
      if (input.kind === "policy") {
        return `${approvalKeyBase}:step:${String(opts.stepIndex)}:policy`;
      }
      if (input.kind === "budget") {
        return `exec:${opts.turnId}:budget`;
      }
      if (opts.attemptId) {
        return `${approvalKeyBase}:attempt:${opts.attemptId}:${input.kind}`;
      }
      return `${approvalKeyBase}:${input.kind}`;
    })();

    const approvalDal = new ApprovalDal(tx);
    let approval = await approvalDal.getByKey({ tenantId: opts.tenantId, approvalKey });
    let resumeToken = approval?.resume_token?.trim() ?? "";

    if (
      !approval ||
      (approval.status !== "queued" &&
        approval.status !== "reviewing" &&
        approval.status !== "awaiting_human")
    ) {
      const suffix =
        approval &&
        approval.status !== "queued" &&
        approval.status !== "reviewing" &&
        approval.status !== "awaiting_human"
          ? `:${randomUUID()}`
          : "";
      const approvalKeyToCreate = suffix ? `${approvalKey}${suffix}` : approvalKey;
      resumeToken = `resume-${randomUUID()}`;

      await tx.run(
        `INSERT INTO resume_tokens (tenant_id, token, turn_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (tenant_id, token) DO NOTHING`,
        [opts.tenantId, resumeToken, opts.turnId, nowIso],
      );

      const baseContext: Record<string, unknown> = {
        ...(isRecord(input.context) ? input.context : {}),
        resume_token: resumeToken,
        conversation_key: opts.key,
        plan_id: opts.planId,
        step_index: opts.stepIndex,
        turn_id: opts.turnId,
        job_id: opts.jobId,
        step_id: opts.stepId,
        ...(opts.attemptId ? { attempt_id: opts.attemptId } : {}),
        paused_reason: pausedReason,
        paused_detail: input.detail,
      };
      const contextToPersist = this.opts.redactUnknown(baseContext);

      approval = await createReviewedApproval({
        approvalDal,
        policyService: this.opts.policyService,
        params: {
          tenantId: opts.tenantId,
          agentId: opts.agentId,
          workspaceId: opts.workspaceId,
          approvalKey: approvalKeyToCreate,
          prompt: input.prompt,
          motivation: input.detail,
          kind: input.kind,
          context: contextToPersist,
          expiresAt,
          turnId: opts.turnId,
          stepId: opts.stepId,
          attemptId: opts.attemptId ?? null,
          resumeToken,
        },
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
          `INSERT INTO resume_tokens (tenant_id, token, turn_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (tenant_id, token) DO NOTHING`,
          [opts.tenantId, resumeToken, opts.turnId, nowIso],
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

    await releaseConversationAndWorkspaceLeasesTx(tx, {
      tenantId: opts.tenantId,
      key: opts.key,
      workspaceId: opts.workspaceId,
      owner: opts.workerId,
    });

    await this.opts.eventEmitter.emitTurnUpdatedTx(tx, opts.turnId);
    await this.opts.eventEmitter.emitStepUpdatedTx(tx, opts.stepId);
    await this.opts.eventEmitter.emitTurnBlockedTx(tx, {
      turnId: opts.turnId,
      reason: pausedReason,
      approvalId: approval.approval_id,
      detail: pausedDetail,
    });

    const approvalContract = toApprovalContract(approval);
    if (approvalContract) {
      const enrichedApproval = await enrichApprovalWithManagedDesktop({
        environmentDal: new DesktopEnvironmentDal(tx),
        tenantId: opts.tenantId,
        approval: approvalContract,
      });
      const approvalRequestedEvt: WsEventEnvelopeT = {
        event_id: randomUUID(),
        type: "approval.updated",
        occurred_at: nowIso,
        scope: { kind: "turn", turn_id: opts.turnId },
        payload: { approval: enrichedApproval },
      };
      await this.opts.eventEmitter.enqueueWsEvent(
        tx,
        opts.tenantId,
        approvalRequestedEvt,
        APPROVAL_WS_AUDIENCE,
      );
    }

    return { approvalId: approval.approval_id, resumeToken };
  }
}

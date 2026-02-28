import type {
  ArtifactRef as ArtifactRefT,
  WsEventEnvelope as WsEventEnvelopeT,
  WsRequestEnvelope as WsRequestEnvelopeT,
} from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import { enqueueWsBroadcastMessage } from "../../../ws/outbox.js";
import type { SqlDb } from "../../../statestore/types.js";
import { normalizeDbDateTime } from "../../../utils/db-time.js";
import { safeJsonParse } from "../../../utils/json.js";
import type { ClockFn } from "./types.js";

export class ExecutionEngineEventEmitter {
  constructor(private readonly opts: { clock: ClockFn; eventsEnabled: boolean }) {}

  async enqueueWsMessage(tx: SqlDb, message: WsEventEnvelopeT | WsRequestEnvelopeT): Promise<void> {
    if (!this.opts.eventsEnabled) return;
    await enqueueWsBroadcastMessage(tx, message);
  }

  async enqueueWsEvent(tx: SqlDb, evt: WsEventEnvelopeT): Promise<void> {
    await this.enqueueWsMessage(tx, evt);
  }

  async emitRunUpdatedTx(tx: SqlDb, runId: string): Promise<void> {
    const row = await tx.get<{
      run_id: string;
      job_id: string;
      key: string;
      lane: string;
      status: string;
      attempt: number;
      created_at: string | Date;
      started_at: string | Date | null;
      finished_at: string | Date | null;
      paused_reason: string | null;
      paused_detail: string | null;
      policy_snapshot_id: string | null;
      budgets_json: string | null;
      budget_overridden_at: string | Date | null;
    }>(
      `SELECT
         run_id,
         job_id,
         key,
         lane,
         status,
         attempt,
         created_at,
         started_at,
         finished_at,
         paused_reason,
         paused_detail,
         policy_snapshot_id,
         budgets_json,
         budget_overridden_at
       FROM execution_runs
       WHERE run_id = ?`,
      [runId],
    );
    if (!row) return;

    const budgets = safeJsonParse(row.budgets_json, undefined as unknown);

    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "run.updated",
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "run", run_id: row.run_id },
      payload: {
        run: {
          run_id: row.run_id,
          job_id: row.job_id,
          key: row.key,
          lane: row.lane,
          status: row.status,
          attempt: row.attempt,
          created_at: normalizeDbDateTime(row.created_at) ?? this.opts.clock().nowIso,
          started_at: normalizeDbDateTime(row.started_at),
          finished_at: normalizeDbDateTime(row.finished_at),
          paused_reason: row.paused_reason ?? undefined,
          paused_detail: row.paused_detail ?? undefined,
          policy_snapshot_id: row.policy_snapshot_id ?? undefined,
          budgets,
          budget_overridden_at: normalizeDbDateTime(row.budget_overridden_at),
        },
      },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  async emitStepUpdatedTx(tx: SqlDb, stepId: string): Promise<void> {
    const row = await tx.get<{
      step_id: string;
      run_id: string;
      step_index: number;
      status: string;
      action_json: string;
      created_at: string | Date;
      idempotency_key: string | null;
      postcondition_json: string | null;
      approval_id: number | null;
    }>(
      `SELECT
         step_id,
         run_id,
         step_index,
         status,
         action_json,
         created_at,
         idempotency_key,
         postcondition_json,
         approval_id
       FROM execution_steps
       WHERE step_id = ?`,
      [stepId],
    );
    if (!row) return;

    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "step.updated",
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "run", run_id: row.run_id },
      payload: {
        step: {
          step_id: row.step_id,
          run_id: row.run_id,
          step_index: row.step_index,
          status: row.status,
          action: safeJsonParse(row.action_json, {}),
          created_at: normalizeDbDateTime(row.created_at) ?? this.opts.clock().nowIso,
          idempotency_key: row.idempotency_key ?? undefined,
          postcondition: safeJsonParse(row.postcondition_json, undefined as unknown),
          approval_id: row.approval_id ?? undefined,
        },
      },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  async emitAttemptUpdatedTx(tx: SqlDb, attemptId: string): Promise<void> {
    const row = await tx.get<{
      attempt_id: string;
      step_id: string;
      attempt: number;
      status: string;
      started_at: string | Date;
      finished_at: string | Date | null;
      result_json: string | null;
      error: string | null;
      postcondition_report_json: string | null;
      artifacts_json: string;
      cost_json: string | null;
      metadata_json: string | null;
      policy_snapshot_id: string | null;
      policy_decision_json: string | null;
      policy_applied_override_ids_json: string | null;
    }>(
      `SELECT
         attempt_id,
         step_id,
         attempt,
         status,
         started_at,
         finished_at,
         result_json,
         error,
         postcondition_report_json,
         artifacts_json,
         cost_json,
         metadata_json,
         policy_snapshot_id,
         policy_decision_json,
         policy_applied_override_ids_json
       FROM execution_attempts
       WHERE attempt_id = ?`,
      [attemptId],
    );
    if (!row) return;

    const step = await tx.get<{ run_id: string }>(
      "SELECT run_id FROM execution_steps WHERE step_id = ?",
      [row.step_id],
    );

    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "attempt.updated",
      occurred_at: this.opts.clock().nowIso,
      scope: step ? { kind: "run", run_id: step.run_id } : undefined,
      payload: {
        attempt: {
          attempt_id: row.attempt_id,
          step_id: row.step_id,
          attempt: row.attempt,
          status: row.status,
          started_at: normalizeDbDateTime(row.started_at) ?? this.opts.clock().nowIso,
          finished_at: normalizeDbDateTime(row.finished_at),
          result: safeJsonParse(row.result_json, undefined as unknown),
          error: row.error,
          postcondition_report: safeJsonParse(row.postcondition_report_json, undefined as unknown),
          artifacts: safeJsonParse(row.artifacts_json, [] as unknown[]),
          cost: safeJsonParse(row.cost_json, undefined as unknown),
          metadata: safeJsonParse(row.metadata_json, undefined as unknown),
          policy_snapshot_id: row.policy_snapshot_id ?? undefined,
          policy_decision: safeJsonParse(row.policy_decision_json, undefined as unknown),
          policy_applied_override_ids: safeJsonParse(
            row.policy_applied_override_ids_json,
            undefined as unknown,
          ),
        },
      },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  async emitArtifactCreatedTx(
    tx: SqlDb,
    opts: { runId: string; artifact: ArtifactRefT },
  ): Promise<void> {
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "artifact.created",
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "run", run_id: opts.runId },
      payload: { artifact: opts.artifact },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  async emitArtifactAttachedTx(
    tx: SqlDb,
    opts: { runId: string; stepId: string; attemptId: string; artifact: ArtifactRefT },
  ): Promise<void> {
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "artifact.attached",
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "run", run_id: opts.runId },
      payload: {
        artifact: opts.artifact,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
      },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  async emitRunIdEventTx(
    tx: SqlDb,
    type: "run.queued" | "run.started" | "run.resumed" | "run.completed" | "run.failed",
    runId: string,
  ): Promise<void> {
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type,
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "run", run_id: runId },
      payload: { run_id: runId },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  async emitRunPausedTx(
    tx: SqlDb,
    opts: {
      runId: string;
      reason: string;
      approvalId?: number;
      detail?: string;
    },
  ): Promise<void> {
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "run.paused",
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "run", run_id: opts.runId },
      payload: {
        run_id: opts.runId,
        reason: opts.reason,
        approval_id: opts.approvalId,
        detail: opts.detail,
      },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  async emitRunCancelledTx(tx: SqlDb, opts: { runId: string; reason?: string }): Promise<void> {
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "run.cancelled",
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "run", run_id: opts.runId },
      payload: { run_id: opts.runId, reason: opts.reason },
    };
    await this.enqueueWsEvent(tx, evt);
  }
}

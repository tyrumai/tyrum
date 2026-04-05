import type {
  ArtifactRef as ArtifactRefT,
  TurnTriggerKind as TurnTriggerKindT,
  WsEventEnvelope as WsEventEnvelopeT,
  WsRequestEnvelope as WsRequestEnvelopeT,
} from "@tyrum/contracts";
import { TurnTriggerKind } from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { WsBroadcastAudience } from "../../../ws/audience.js";
import { enqueueWsBroadcastMessage } from "../../../ws/outbox.js";
import type { SqlDb } from "../../../statestore/types.js";
import { normalizeDbDateTime } from "../../../utils/db-time.js";
import { safeJsonParse } from "../../../utils/json.js";
import type { ClockFn, ExecutionEventPort } from "./types.js";
import { syncWorkflowRunStateFromTurnTx } from "./workflow-run-state-sync.js";
import { createArtifactAttachedEvent } from "../../artifact/execution-artifacts.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseTriggerKind(triggerJson: string | null | undefined): TurnTriggerKindT | undefined {
  const trigger = safeJsonParse(triggerJson, undefined as unknown);
  if (!isRecord(trigger)) {
    return undefined;
  }

  const kind = trigger["kind"];
  const parsed = TurnTriggerKind.safeParse(kind);
  return parsed.success ? parsed.data : undefined;
}

export class ExecutionEngineEventEmitter implements ExecutionEventPort<
  SqlDb,
  WsEventEnvelopeT,
  WsEventEnvelopeT | WsRequestEnvelopeT,
  WsBroadcastAudience
> {
  constructor(private readonly opts: { clock: ClockFn; eventsEnabled: boolean }) {}

  async enqueueWsMessage(
    tx: SqlDb,
    tenantId: string,
    message: WsEventEnvelopeT | WsRequestEnvelopeT,
    audience?: WsBroadcastAudience,
  ): Promise<void> {
    if (!this.opts.eventsEnabled) return;
    const normalizedTenantId = tenantId.trim();
    if (normalizedTenantId.length === 0) {
      throw new Error("tenantId is required");
    }
    await enqueueWsBroadcastMessage(tx, normalizedTenantId, message, audience);
  }

  async enqueueWsEvent(
    tx: SqlDb,
    tenantId: string,
    evt: WsEventEnvelopeT,
    audience?: WsBroadcastAudience,
  ): Promise<void> {
    await this.enqueueWsMessage(tx, tenantId, evt, audience);
  }

  private async resolveTenantIdForTurnIdTx(tx: SqlDb, turnId: string): Promise<string | null> {
    const row = await tx.get<{ tenant_id: string }>(
      "SELECT tenant_id FROM turns WHERE turn_id = ? LIMIT 1",
      [turnId],
    );
    const tenantId = row?.tenant_id?.trim();
    return tenantId && tenantId.length > 0 ? tenantId : null;
  }

  async emitTurnUpdatedTx(tx: SqlDb, turnId: string): Promise<void> {
    const row = await tx.get<{
      tenant_id: string;
      turn_id: string;
      job_id: string;
      key: string;
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
      trigger_json: string | null;
    }>(
      `SELECT
         r.tenant_id,
         r.turn_id AS turn_id,
         r.job_id,
         r.conversation_key AS key,
         r.status,
         r.attempt,
         r.created_at,
         r.started_at,
         r.finished_at,
         r.blocked_reason AS paused_reason,
         r.blocked_detail AS paused_detail,
         r.policy_snapshot_id,
         r.budgets_json,
         r.budget_overridden_at,
         j.trigger_json
       FROM turns r
       LEFT JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
       WHERE r.turn_id = ?`,
      [turnId],
    );
    if (!row) return;

    await syncWorkflowRunStateFromTurnTx(tx, {
      tenantId: row.tenant_id,
      workflowRunId: row.turn_id,
      status: row.status,
      attempt: row.attempt,
      updatedAtIso: this.opts.clock().nowIso,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      blockedReason: row.paused_reason,
      blockedDetail: row.paused_detail,
    });

    const budgets = safeJsonParse(row.budgets_json, undefined as unknown);
    const triggerKind = parseTriggerKind(row.trigger_json);

    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "turn.updated",
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "turn", turn_id: row.turn_id },
      payload: {
        turn: {
          turn_id: row.turn_id,
          job_id: row.job_id,
          conversation_key: row.key,
          status: row.status,
          attempt: row.attempt,
          created_at: normalizeDbDateTime(row.created_at) ?? this.opts.clock().nowIso,
          started_at: normalizeDbDateTime(row.started_at),
          finished_at: normalizeDbDateTime(row.finished_at),
          blocked_reason: row.paused_reason ?? undefined,
          blocked_detail: row.paused_detail ?? undefined,
          policy_snapshot_id: row.policy_snapshot_id ?? undefined,
          budgets,
          budget_overridden_at: normalizeDbDateTime(row.budget_overridden_at),
        },
        trigger_kind: triggerKind,
      },
    };
    await this.enqueueWsEvent(tx, row.tenant_id, evt);
  }

  async emitStepUpdatedTx(tx: SqlDb, stepId: string): Promise<void> {
    const row = await tx.get<{
      tenant_id: string;
      step_id: string;
      turn_id: string;
      step_index: number;
      status: string;
      action_json: string;
      created_at: string | Date;
      idempotency_key: string | null;
      postcondition_json: string | null;
      approval_id: number | null;
    }>(
      `SELECT
         tenant_id,
         step_id,
         turn_id AS turn_id,
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
      scope: { kind: "turn", turn_id: row.turn_id },
      payload: {
        step: {
          step_id: row.step_id,
          turn_id: row.turn_id,
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
    await this.enqueueWsEvent(tx, row.tenant_id, evt);
  }

  async emitAttemptUpdatedTx(tx: SqlDb, attemptId: string): Promise<void> {
    const row = await tx.get<{
      tenant_id: string;
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
         tenant_id,
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

    const step = await tx.get<{ turn_id: string }>(
      "SELECT turn_id AS turn_id FROM execution_steps WHERE tenant_id = ? AND step_id = ?",
      [row.tenant_id, row.step_id],
    );

    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "attempt.updated",
      occurred_at: this.opts.clock().nowIso,
      scope: step ? { kind: "turn", turn_id: step.turn_id } : undefined,
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
    await this.enqueueWsEvent(tx, row.tenant_id, evt);
  }

  async emitArtifactCreatedTx(
    tx: SqlDb,
    opts: { tenantId: string; turnId: string; artifact: ArtifactRefT },
  ): Promise<void> {
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "artifact.created",
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "turn", turn_id: opts.turnId },
      payload: { artifact: opts.artifact },
    };
    await this.enqueueWsEvent(tx, opts.tenantId, evt);
  }

  async emitArtifactAttachedTx(
    tx: SqlDb,
    opts: {
      tenantId: string;
      turnId: string;
      turnItemId?: string | null;
      workflowRunStepId?: string | null;
      dispatchId?: string | null;
      artifact: ArtifactRefT;
    },
  ): Promise<void> {
    const evt = createArtifactAttachedEvent({
      artifact: opts.artifact,
      occurredAt: this.opts.clock().nowIso,
      scope: {
        turnId: opts.turnId,
        turnItemId: opts.turnItemId,
        workflowRunStepId: opts.workflowRunStepId,
        dispatchId: opts.dispatchId,
      },
    });
    if (!evt) {
      return;
    }
    await this.enqueueWsEvent(tx, opts.tenantId, evt);
  }

  async emitTurnLifecycleEventTx(
    tx: SqlDb,
    type: "turn.queued" | "turn.started" | "turn.resumed" | "turn.completed" | "turn.failed",
    turnId: string,
  ): Promise<void> {
    const tenantId = await this.resolveTenantIdForTurnIdTx(tx, turnId);
    if (!tenantId) return;
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type,
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "turn", turn_id: turnId },
      payload: { turn_id: turnId },
    };
    await this.enqueueWsEvent(tx, tenantId, evt);
  }

  async emitTurnBlockedTx(
    tx: SqlDb,
    opts: {
      turnId: string;
      reason: string;
      approvalId?: string;
      detail?: string;
    },
  ): Promise<void> {
    const tenantId = await this.resolveTenantIdForTurnIdTx(tx, opts.turnId);
    if (!tenantId) return;
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "turn.blocked",
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "turn", turn_id: opts.turnId },
      payload: {
        turn_id: opts.turnId,
        reason: opts.reason,
        approval_id: opts.approvalId,
        detail: opts.detail,
      },
    };
    await this.enqueueWsEvent(tx, tenantId, evt);
  }

  async emitTurnCancelledTx(tx: SqlDb, opts: { turnId: string; reason?: string }): Promise<void> {
    const tenantId = await this.resolveTenantIdForTurnIdTx(tx, opts.turnId);
    if (!tenantId) return;
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "turn.cancelled",
      occurred_at: this.opts.clock().nowIso,
      scope: { kind: "turn", turn_id: opts.turnId },
      payload: { turn_id: opts.turnId, reason: opts.reason },
    };
    await this.enqueueWsEvent(tx, tenantId, evt);
  }
}

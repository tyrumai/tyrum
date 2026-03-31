import type {
  TurnStatus as TurnStatusT,
  TurnTriggerKind as TurnTriggerKindT,
} from "@tyrum/contracts";
import { TurnStatus, TurnTriggerKind } from "@tyrum/contracts";
import {
  clearTurnLeaseStateTx,
  recordTurnProgressTx,
  setTurnCheckpointStateTx,
  setTurnLeaseStateTx,
} from "@tyrum/runtime-execution";
import type { SqlDb } from "../../../statestore/types.js";
import { normalizeDbDateTime } from "../../../utils/db-time.js";
import { safeJsonParse } from "../../../utils/json.js";
import {
  releaseConversationLeaseTx,
  tryAcquireConversationLease,
} from "../../execution/engine/concurrency-manager.js";

type RawTurnRunnerRow = {
  tenant_id: string;
  turn_id: string;
  job_id: string;
  conversation_key: string;
  status: string;
  attempt: number;
  created_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  blocked_reason: string | null;
  blocked_detail: string | null;
  budget_overridden_at: string | Date | null;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  checkpoint_json: string | null;
  last_progress_at: string | Date | null;
  last_progress_json: string | null;
  trigger_json: string | null;
};

export interface TurnRunnerTurn {
  tenant_id: string;
  turn_id: string;
  job_id: string;
  conversation_key: string;
  status: TurnStatusT;
  attempt: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  blocked_reason: string | null;
  blocked_detail: string | null;
  budget_overridden_at: string | null;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  checkpoint: unknown | null;
  last_progress_at: string | null;
  last_progress: Record<string, unknown> | null;
  trigger_kind: TurnTriggerKindT | undefined;
}

export type TurnRunnerClaimResult =
  | { kind: "claimed"; turn: TurnRunnerTurn }
  | { kind: "not_found" }
  | { kind: "unsupported"; triggerKind: TurnTriggerKindT | undefined }
  | { kind: "lease_unavailable" }
  | { kind: "terminal"; status: TurnStatusT }
  | { kind: "not_claimable"; status: TurnStatusT };

export type TurnRunnerResumeResult =
  | { kind: "resumed"; turn: TurnRunnerTurn }
  | { kind: "not_found" }
  | { kind: "unsupported"; triggerKind: TurnTriggerKindT | undefined }
  | { kind: "lease_unavailable" }
  | { kind: "terminal"; status: TurnStatusT }
  | { kind: "not_paused"; status: TurnStatusT };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTerminalStatus(status: TurnStatusT): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function parseTriggerKind(raw: string | null): TurnTriggerKindT | undefined {
  const parsed = safeJsonParse(raw, undefined as unknown);
  if (!isRecord(parsed)) {
    return undefined;
  }
  const triggerKind = TurnTriggerKind.safeParse(parsed["kind"]);
  return triggerKind.success ? triggerKind.data : undefined;
}

function parseProgress(raw: string | null): Record<string, unknown> | null {
  const parsed = safeJsonParse(raw, null as Record<string, unknown> | null);
  return isRecord(parsed) ? parsed : null;
}

function toTurn(raw: RawTurnRunnerRow): TurnRunnerTurn {
  const parsedStatus = TurnStatus.safeParse(raw.status);
  if (!parsedStatus.success) {
    throw new Error(`invalid turn status '${raw.status}'`);
  }

  return {
    tenant_id: raw.tenant_id,
    turn_id: raw.turn_id,
    job_id: raw.job_id,
    conversation_key: raw.conversation_key,
    status: parsedStatus.data,
    attempt: raw.attempt,
    created_at: normalizeDbDateTime(raw.created_at) ?? new Date().toISOString(),
    started_at: normalizeDbDateTime(raw.started_at),
    finished_at: normalizeDbDateTime(raw.finished_at),
    blocked_reason: raw.blocked_reason,
    blocked_detail: raw.blocked_detail,
    budget_overridden_at: normalizeDbDateTime(raw.budget_overridden_at),
    lease_owner: raw.lease_owner,
    lease_expires_at_ms: raw.lease_expires_at_ms,
    checkpoint: safeJsonParse(raw.checkpoint_json, null as unknown),
    last_progress_at: normalizeDbDateTime(raw.last_progress_at),
    last_progress: parseProgress(raw.last_progress_json),
    trigger_kind: parseTriggerKind(raw.trigger_json),
  };
}

function canTakeLease(turn: TurnRunnerTurn, owner: string, nowMs: number): boolean {
  if (!turn.lease_owner) return true;
  if (turn.lease_owner === owner) return true;
  return turn.lease_expires_at_ms !== null && turn.lease_expires_at_ms <= nowMs;
}

export class TurnRunner {
  constructor(private readonly db: SqlDb) {}

  async claim(input: {
    tenantId: string;
    turnId: string;
    owner: string;
    nowMs: number;
    nowIso: string;
    leaseTtlMs: number;
  }): Promise<TurnRunnerClaimResult> {
    return await this.db.transaction(async (tx) => {
      const turn = await this.getTurnTx(tx, input.tenantId, input.turnId);
      if (!turn) return { kind: "not_found" };
      if (isTerminalStatus(turn.status)) return { kind: "terminal", status: turn.status };
      if (turn.trigger_kind !== "conversation") {
        return { kind: "unsupported", triggerKind: turn.trigger_kind };
      }
      if (turn.status !== "queued" && turn.status !== "running") {
        return { kind: "not_claimable", status: turn.status };
      }
      if (!canTakeLease(turn, input.owner, input.nowMs)) {
        return { kind: "lease_unavailable" };
      }

      const claimed = await this.claimLeaseTx(tx, turn, input);
      if (!claimed) {
        return { kind: "lease_unavailable" };
      }

      const runUpdated = await tx.run(
        `UPDATE turns
         SET status = 'running',
             started_at = COALESCE(started_at, ?)
         WHERE tenant_id = ? AND turn_id = ? AND status IN ('queued', 'running')`,
        [input.nowIso, input.tenantId, input.turnId],
      );
      if (runUpdated.changes !== 1) {
        return { kind: "lease_unavailable" };
      }
      await tx.run(
        `UPDATE turn_jobs
         SET status = 'running'
         WHERE tenant_id = ? AND job_id = ? AND status = 'queued'`,
        [turn.tenant_id, turn.job_id],
      );
      await recordTurnProgressTx(tx, {
        tenantId: input.tenantId,
        turnId: input.turnId,
        at: input.nowIso,
        progress: { kind: "turn.claimed", owner: input.owner },
      });
      return { kind: "claimed", turn: await this.requireTurnTx(tx, input.tenantId, input.turnId) };
    });
  }

  async resume(input: {
    tenantId: string;
    turnId: string;
    owner: string;
    nowMs: number;
    nowIso: string;
    leaseTtlMs: number;
    overrideBudget?: boolean;
  }): Promise<TurnRunnerResumeResult> {
    return await this.db.transaction(async (tx) => {
      const turn = await this.getTurnTx(tx, input.tenantId, input.turnId);
      if (!turn) return { kind: "not_found" };
      if (isTerminalStatus(turn.status)) return { kind: "terminal", status: turn.status };
      if (turn.trigger_kind !== "conversation") {
        return { kind: "unsupported", triggerKind: turn.trigger_kind };
      }
      if (turn.status !== "paused") return { kind: "not_paused", status: turn.status };
      if (!canTakeLease(turn, input.owner, input.nowMs)) {
        return { kind: "lease_unavailable" };
      }

      const claimed = await this.claimLeaseTx(tx, turn, input);
      if (!claimed) {
        return { kind: "lease_unavailable" };
      }

      const runUpdated = await tx.run(
        `UPDATE turns
         SET status = 'running',
             blocked_reason = NULL,
             blocked_detail = NULL,
             budget_overridden_at = CASE
               WHEN ? = 1 AND blocked_reason = 'budget' THEN COALESCE(budget_overridden_at, ?)
               ELSE budget_overridden_at
             END
         WHERE tenant_id = ? AND turn_id = ? AND status = 'paused'`,
        [input.overrideBudget ? 1 : 0, input.nowIso, input.tenantId, input.turnId],
      );
      if (runUpdated.changes !== 1) {
        return { kind: "lease_unavailable" };
      }
      await tx.run(
        `UPDATE turn_jobs
         SET status = 'running'
         WHERE tenant_id = ? AND job_id = ? AND status = 'queued'`,
        [turn.tenant_id, turn.job_id],
      );
      await recordTurnProgressTx(tx, {
        tenantId: input.tenantId,
        turnId: input.turnId,
        at: input.nowIso,
        progress: { kind: "turn.resumed", owner: input.owner },
      });
      return { kind: "resumed", turn: await this.requireTurnTx(tx, input.tenantId, input.turnId) };
    });
  }

  async heartbeat(input: {
    tenantId: string;
    turnId: string;
    owner: string;
    nowMs: number;
    nowIso: string;
    leaseTtlMs: number;
    checkpoint?: unknown | null;
    progress?: Record<string, unknown> | null;
  }): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const turn = await this.getTurnTx(tx, input.tenantId, input.turnId);
      if (!turn || turn.trigger_kind !== "conversation" || turn.status !== "running") return false;
      if (turn.lease_owner !== input.owner) return false;

      const claimed = await this.claimLeaseTx(tx, turn, input);
      if (!claimed) return false;
      if (input.checkpoint !== undefined) {
        await setTurnCheckpointStateTx(tx, {
          tenantId: input.tenantId,
          turnId: input.turnId,
          checkpoint: input.checkpoint,
        });
      }
      await recordTurnProgressTx(tx, {
        tenantId: input.tenantId,
        turnId: input.turnId,
        at: input.nowIso,
        progress: input.progress ?? { kind: "turn.heartbeat", owner: input.owner },
      });
      return true;
    });
  }

  async complete(input: {
    tenantId: string;
    turnId: string;
    owner: string;
    nowIso: string;
  }): Promise<boolean> {
    return await this.finish(input, "succeeded", { kind: "turn.completed" });
  }

  async fail(input: {
    tenantId: string;
    turnId: string;
    owner: string;
    nowIso: string;
    error: string;
  }): Promise<boolean> {
    return await this.finish(input, "failed", {
      kind: "turn.failed",
      error: input.error,
    });
  }

  private async finish(
    input: { tenantId: string; turnId: string; owner: string; nowIso: string },
    status: "succeeded" | "failed",
    progress: Record<string, unknown>,
  ): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const turn = await this.getTurnTx(tx, input.tenantId, input.turnId);
      if (!turn || turn.trigger_kind !== "conversation" || isTerminalStatus(turn.status)) {
        return false;
      }
      if (turn.lease_owner !== input.owner) return false;

      await tx.run(
        `UPDATE turns
         SET status = ?, finished_at = COALESCE(finished_at, ?)
         WHERE tenant_id = ? AND turn_id = ?`,
        [status, input.nowIso, input.tenantId, input.turnId],
      );
      await tx.run(
        `UPDATE turn_jobs
         SET status = ?
         WHERE tenant_id = ? AND job_id = ?`,
        [status === "succeeded" ? "completed" : "failed", turn.tenant_id, turn.job_id],
      );
      await clearTurnLeaseStateTx(tx, { tenantId: input.tenantId, turnId: input.turnId });
      await recordTurnProgressTx(tx, {
        tenantId: input.tenantId,
        turnId: input.turnId,
        at: input.nowIso,
        progress,
      });
      await releaseConversationLeaseTx(tx, {
        tenantId: input.tenantId,
        key: turn.conversation_key,
        owner: input.owner,
      });
      return true;
    });
  }

  private async claimLeaseTx(
    tx: SqlDb,
    turn: TurnRunnerTurn,
    input: { tenantId: string; turnId: string; owner: string; nowMs: number; leaseTtlMs: number },
  ): Promise<boolean> {
    const claimed = await tryAcquireConversationLease(tx, {
      tenantId: input.tenantId,
      key: turn.conversation_key,
      owner: input.owner,
      nowMs: input.nowMs,
      ttlMs: input.leaseTtlMs,
    });
    if (!claimed) return false;

    await setTurnLeaseStateTx(tx, {
      tenantId: input.tenantId,
      turnId: input.turnId,
      owner: input.owner,
      expiresAtMs: input.nowMs + Math.max(1, input.leaseTtlMs),
    });
    return true;
  }

  private async getTurnTx(
    tx: SqlDb,
    tenantId: string,
    turnId: string,
  ): Promise<TurnRunnerTurn | undefined> {
    const row = await tx.get<RawTurnRunnerRow>(
      `SELECT
         r.tenant_id,
         r.turn_id,
         r.job_id,
         r.conversation_key,
         r.status,
         r.attempt,
         r.created_at,
         r.started_at,
         r.finished_at,
         r.blocked_reason,
         r.blocked_detail,
         r.budget_overridden_at,
         r.lease_owner,
         r.lease_expires_at_ms,
         r.checkpoint_json,
         r.last_progress_at,
         r.last_progress_json,
         j.trigger_json
       FROM turns r
       JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
       WHERE r.tenant_id = ? AND r.turn_id = ?`,
      [tenantId, turnId],
    );
    return row ? toTurn(row) : undefined;
  }

  private async requireTurnTx(
    tx: SqlDb,
    tenantId: string,
    turnId: string,
  ): Promise<TurnRunnerTurn> {
    const turn = await this.getTurnTx(tx, tenantId, turnId);
    if (!turn) {
      throw new Error(`turn '${turnId}' not found after mutation`);
    }
    return turn;
  }
}

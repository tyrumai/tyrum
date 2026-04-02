import type {
  TurnStatus as TurnStatusT,
  TurnTriggerKind as TurnTriggerKindT,
} from "@tyrum/contracts";
import {
  clearTurnLeaseStateTx,
  recordTurnProgressTx,
  setTurnCheckpointStateTx,
  setTurnLeaseStateTx,
} from "@tyrum/runtime-execution";
import type { SqlDb } from "../../../statestore/types.js";
import {
  releaseConversationLeaseTx,
  tryAcquireConversationLeaseTx,
} from "../../execution/engine/concurrency-manager.js";
import {
  DEFAULT_TURN_RUNNER_SCAN_LIMIT,
  getTurnTx,
  listPausedConversationTurns as listPausedConversationTurnRows,
  listRunnableConversationTurns,
  type TurnRunnerTurn,
} from "./turn-runner-store.js";

export type { TurnRunnerTurn } from "./turn-runner-store.js";

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

function isTerminalStatus(status: TurnStatusT): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function canTakeLease(turn: TurnRunnerTurn, owner: string, nowMs: number): boolean {
  if (!turn.lease_owner) return true;
  if (turn.lease_owner === owner) return true;
  return turn.lease_expires_at_ms !== null && turn.lease_expires_at_ms <= nowMs;
}

export class TurnRunner {
  constructor(private readonly db: SqlDb) {}

  async claimNextConversationTurn(input: {
    tenantId: string;
    owner: string;
    nowMs: number;
    nowIso: string;
    leaseTtlMs: number;
    limit?: number;
  }): Promise<TurnRunnerClaimResult | undefined> {
    const candidates = await listRunnableConversationTurns(this.db, input.tenantId, input.limit);
    for (const candidate of candidates) {
      const claimed = await this.claim({
        tenantId: input.tenantId,
        turnId: candidate.turn_id,
        owner: input.owner,
        nowMs: input.nowMs,
        nowIso: input.nowIso,
        leaseTtlMs: input.leaseTtlMs,
      });
      if (claimed.kind === "claimed") {
        return claimed;
      }
      if (
        claimed.kind === "terminal" ||
        claimed.kind === "unsupported" ||
        claimed.kind === "lease_unavailable" ||
        claimed.kind === "not_claimable"
      ) {
        continue;
      }
    }
    return undefined;
  }

  async listPausedConversationTurns(
    tenantId: string,
    limit = DEFAULT_TURN_RUNNER_SCAN_LIMIT,
  ): Promise<TurnRunnerTurn[]> {
    return await listPausedConversationTurnRows(this.db, tenantId, limit);
  }

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

  async pause(input: {
    tenantId: string;
    turnId: string;
    owner: string;
    nowIso: string;
    reason: string;
    detail: string;
    checkpoint?: unknown | null;
  }): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const turn = await this.getTurnTx(tx, input.tenantId, input.turnId);
      if (!turn || turn.trigger_kind !== "conversation" || isTerminalStatus(turn.status)) {
        return false;
      }
      if (turn.lease_owner !== input.owner) return false;

      const runUpdated = await tx.run(
        `UPDATE turns
         SET status = 'paused',
             blocked_reason = ?,
             blocked_detail = ?
         WHERE tenant_id = ? AND turn_id = ? AND status IN ('queued', 'running')`,
        [input.reason, input.detail, input.tenantId, input.turnId],
      );
      if (runUpdated.changes !== 1) return false;
      await clearTurnLeaseStateTx(tx, { tenantId: input.tenantId, turnId: input.turnId });
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
        progress: {
          kind: "turn.paused",
          paused_reason: input.reason,
        },
      });
      await releaseConversationLeaseTx(tx, {
        tenantId: input.tenantId,
        key: turn.conversation_key,
        owner: input.owner,
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
      await setTurnCheckpointStateTx(tx, {
        tenantId: input.tenantId,
        turnId: input.turnId,
        checkpoint: null,
      });
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
    const claimed = await tryAcquireConversationLeaseTx(tx, {
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
    return await getTurnTx(tx, tenantId, turnId);
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

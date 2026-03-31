import type {
  ClockFn,
  ExecutionConcurrencyLimits,
  ExecutionDb,
  ExecutionTurnEventPort,
} from "./types.js";
import { clearTurnLeaseStateTx, recordTurnProgressTx } from "./turn-state.js";

interface RunControlDeps<TDb extends ExecutionDb<TDb>> extends ExecutionTurnEventPort<TDb> {
  db: TDb;
  clock: ClockFn;
  redactText(text: string): string;
  concurrencyLimits?: ExecutionConcurrencyLimits;
  emitTurnResumedTx(tx: TDb, turnId: string): Promise<void>;
  emitTurnCancelledTx(tx: TDb, opts: { turnId: string; reason?: string }): Promise<void>;
  releaseConcurrencySlotsTx(
    tx: TDb,
    tenantId: string,
    attemptId: string,
    nowIso: string,
    concurrencyLimits?: ExecutionConcurrencyLimits,
  ): Promise<void>;
}

interface ResumeTokenRow {
  tenant_id: string;
  token: string;
  turn_id: string;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
}

export async function resumeTurn<TDb extends ExecutionDb<TDb>>(
  deps: RunControlDeps<TDb>,
  token: string,
): Promise<string | undefined> {
  const { nowIso } = deps.clock();
  return await deps.db.transaction(async (tx) => {
    const row = await tx.get<ResumeTokenRow>(
      `SELECT tenant_id, token, turn_id AS turn_id, expires_at, revoked_at
       FROM resume_tokens
       WHERE token = ?`,
      [token],
    );
    if (!row || row.revoked_at) return undefined;

    if (row.expires_at) {
      const expiresAtMs =
        row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(row.expires_at);
      if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
        await tx.run(
          `UPDATE resume_tokens
           SET revoked_at = ?
           WHERE tenant_id = ? AND token = ? AND revoked_at IS NULL`,
          [nowIso, row.tenant_id, token],
        );
        return undefined;
      }
    }

    await tx.run(
      `UPDATE resume_tokens
       SET revoked_at = ?
       WHERE tenant_id = ? AND token = ? AND revoked_at IS NULL`,
      [nowIso, row.tenant_id, token],
    );

    const approval = await tx.get<{ kind: string }>(
      "SELECT kind FROM approvals WHERE tenant_id = ? AND resume_token = ? LIMIT 1",
      [row.tenant_id, token],
    );
    const runResumed = await tx.run(
      `UPDATE turns
       SET status = 'queued', blocked_reason = NULL, blocked_detail = NULL
       WHERE tenant_id = ? AND turn_id = ? AND status = 'paused'`,
      [row.tenant_id, row.turn_id],
    );
    if (runResumed.changes !== 1) {
      return undefined;
    }

    if (approval?.kind === "budget") {
      await tx.run(
        `UPDATE turns
         SET budget_overridden_at = COALESCE(budget_overridden_at, ?)
         WHERE tenant_id = ? AND turn_id = ?`,
        [nowIso, row.tenant_id, row.turn_id],
      );
    }

    await clearTurnLeaseStateTx(tx, {
      tenantId: row.tenant_id,
      turnId: row.turn_id,
    });
    await recordTurnProgressTx(tx, {
      tenantId: row.tenant_id,
      turnId: row.turn_id,
      at: nowIso,
      progress: {
        kind: "turn.resumed",
        approval_kind: approval?.kind ?? null,
      },
    });

    await tx.run(
      `UPDATE execution_steps
       SET status = 'queued'
       WHERE tenant_id = ? AND turn_id = ? AND status = 'paused'`,
      [row.tenant_id, row.turn_id],
    );

    await deps.emitTurnUpdatedTx(tx, row.turn_id);
    const stepIds = await tx.all<{ step_id: string }>(
      "SELECT step_id FROM execution_steps WHERE tenant_id = ? AND turn_id = ? ORDER BY step_index ASC",
      [row.tenant_id, row.turn_id],
    );
    for (const step of stepIds) {
      await deps.emitStepUpdatedTx(tx, step.step_id);
    }

    await deps.emitTurnResumedTx(tx, row.turn_id);

    return row.turn_id;
  });
}

export async function cancelTurn<TDb extends ExecutionDb<TDb>>(
  deps: RunControlDeps<TDb>,
  turnId: string,
  reason?: string,
): Promise<"cancelled" | "already_terminal" | "not_found"> {
  const { nowIso } = deps.clock();
  const detail = reason ? deps.redactText(reason) : null;

  return await deps.db.transaction(async (tx) => {
    const row = await tx.get<{
      tenant_id: string;
      turn_id: string;
      status: string;
      job_id: string;
      key: string;
    }>(
      `SELECT tenant_id, turn_id AS turn_id, status, job_id, conversation_key AS key
       FROM turns
       WHERE turn_id = ?`,
      [turnId],
    );
    if (!row) return "not_found";

    if (row.status === "cancelled") {
      await tx.run(
        `UPDATE resume_tokens
         SET revoked_at = ?
         WHERE tenant_id = ? AND turn_id = ? AND revoked_at IS NULL`,
        [nowIso, row.tenant_id, turnId],
      );
      return "cancelled";
    }
    if (row.status === "succeeded" || row.status === "failed") {
      return "already_terminal";
    }

    await tx.run(
      `UPDATE turns
       SET status = 'cancelled',
           finished_at = COALESCE(finished_at, ?),
           blocked_reason = COALESCE(blocked_reason, 'cancelled'),
           blocked_detail = COALESCE(blocked_detail, ?)
       WHERE tenant_id = ? AND turn_id = ?`,
      [nowIso, detail, row.tenant_id, turnId],
    );

    await tx.run(
      `UPDATE turn_jobs
       SET status = 'cancelled'
       WHERE tenant_id = ? AND job_id = ?`,
      [row.tenant_id, row.job_id],
    );

    await clearTurnLeaseStateTx(tx, {
      tenantId: row.tenant_id,
      turnId,
    });
    await recordTurnProgressTx(tx, {
      tenantId: row.tenant_id,
      turnId,
      at: nowIso,
      progress: {
        kind: "turn.cancelled",
        reason: detail ?? "cancelled",
      },
    });

    await tx.run(
      `UPDATE execution_steps
       SET status = 'cancelled'
       WHERE tenant_id = ? AND turn_id = ?
         AND status IN ('queued', 'paused', 'running')`,
      [row.tenant_id, turnId],
    );

    await tx.run(
      `UPDATE resume_tokens
       SET revoked_at = ?
       WHERE tenant_id = ? AND turn_id = ? AND revoked_at IS NULL`,
      [nowIso, row.tenant_id, turnId],
    );

    const runningAttempts = await tx.all<{ attempt_id: string }>(
      `SELECT a.attempt_id
       FROM execution_attempts a
       JOIN execution_steps s ON s.tenant_id = a.tenant_id AND s.step_id = a.step_id
       WHERE s.tenant_id = ? AND s.turn_id = ? AND a.status = 'running'`,
      [row.tenant_id, turnId],
    );
    await tx.run(
      `UPDATE execution_attempts
       SET status = 'cancelled', finished_at = COALESCE(finished_at, ?), error = COALESCE(error, 'cancelled')
       WHERE tenant_id = ?
         AND status = 'running'
         AND step_id IN (SELECT step_id FROM execution_steps WHERE tenant_id = ? AND turn_id = ?)`,
      [nowIso, row.tenant_id, row.tenant_id, turnId],
    );

    for (const attempt of runningAttempts) {
      await deps.releaseConcurrencySlotsTx(
        tx,
        row.tenant_id,
        attempt.attempt_id,
        nowIso,
        deps.concurrencyLimits,
      );
    }

    await deps.emitTurnUpdatedTx(tx, turnId);
    const stepIds = await tx.all<{ step_id: string }>(
      "SELECT step_id FROM execution_steps WHERE tenant_id = ? AND turn_id = ? ORDER BY step_index ASC",
      [row.tenant_id, turnId],
    );
    for (const step of stepIds) {
      await deps.emitStepUpdatedTx(tx, step.step_id);
    }
    for (const attempt of runningAttempts) {
      await deps.emitAttemptUpdatedTx(tx, attempt.attempt_id);
    }

    await deps.emitTurnCancelledTx(tx, { turnId, reason: detail ?? undefined });

    return "cancelled";
  });
}

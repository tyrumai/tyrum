import {
  clearTurnLeaseStateTx,
  recordTurnProgressTx,
  setTurnCheckpointStateTx,
} from "@tyrum/runtime-execution";
import type { SqlDb } from "../../../statestore/types.js";

export interface TurnController {
  resumeTurn(token: string): Promise<string | undefined>;
  cancelTurn(
    turnId: string,
    reason?: string,
  ): Promise<"cancelled" | "already_terminal" | "not_found">;
}

export interface TurnControllerOptions {
  db: SqlDb;
  redactText?: (text: string) => string;
}

type ResumeTokenRow = {
  tenant_id: string;
  turn_id: string;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
};

type ApprovalResumeRow = {
  approval_id: string;
  kind: string;
  turn_id: string | null;
};

type TurnRow = {
  tenant_id: string;
  job_id: string;
  conversation_key: string;
  status: string;
};

function isTerminalTurnStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function normalizeExpiresAtMs(value: string | Date | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const expiresAtMs = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(expiresAtMs) ? expiresAtMs : undefined;
}

export class NativeTurnController implements TurnController {
  private readonly redactText: (text: string) => string;

  constructor(private readonly options: TurnControllerOptions) {
    this.redactText = options.redactText ?? ((text: string) => text);
  }

  async resumeTurn(token: string): Promise<string | undefined> {
    const resumeToken = token.trim();
    if (!resumeToken) {
      return undefined;
    }

    return await this.options.db.transaction(async (tx) => {
      const resumeRow = await tx.get<ResumeTokenRow>(
        `SELECT tenant_id, turn_id, expires_at, revoked_at
           FROM resume_tokens
          WHERE token = ?
          LIMIT 1`,
        [resumeToken],
      );
      if (!resumeRow || resumeRow.revoked_at) {
        return undefined;
      }

      const expiresAtMs = normalizeExpiresAtMs(resumeRow.expires_at);
      if (expiresAtMs !== undefined && expiresAtMs <= Date.now()) {
        await tx.run(
          `UPDATE resume_tokens
              SET revoked_at = ?
            WHERE tenant_id = ?
              AND token = ?
              AND revoked_at IS NULL`,
          [new Date().toISOString(), resumeRow.tenant_id, resumeToken],
        );
        return undefined;
      }

      const approval = await tx.get<ApprovalResumeRow>(
        `SELECT approval_id, kind, turn_id
           FROM approvals
          WHERE tenant_id = ?
            AND resume_token = ?
          ORDER BY created_at DESC
          LIMIT 1`,
        [resumeRow.tenant_id, resumeToken],
      );
      const turnId = approval?.turn_id?.trim() || resumeRow.turn_id.trim();
      if (!turnId) {
        return undefined;
      }

      const turn = await tx.get<TurnRow>(
        `SELECT tenant_id, job_id, conversation_key, status
           FROM turns
          WHERE tenant_id = ?
            AND turn_id = ?
          LIMIT 1`,
        [resumeRow.tenant_id, turnId],
      );
      if (!turn) {
        return undefined;
      }

      const nowIso = new Date().toISOString();
      await tx.run(
        `UPDATE resume_tokens
            SET revoked_at = ?
          WHERE tenant_id = ?
            AND token = ?
            AND revoked_at IS NULL`,
        [nowIso, resumeRow.tenant_id, resumeToken],
      );

      if (isTerminalTurnStatus(turn.status)) {
        return turnId;
      }

      await tx.run(
        `UPDATE turns
            SET status = 'queued',
                blocked_reason = NULL,
                blocked_detail = NULL,
                budget_overridden_at = CASE
                  WHEN ? = 'budget' THEN COALESCE(budget_overridden_at, ?)
                  ELSE budget_overridden_at
                END
          WHERE tenant_id = ?
            AND turn_id = ?
            AND status = 'paused'`,
        [approval?.kind ?? "", nowIso, resumeRow.tenant_id, turnId],
      );
      await tx.run(
        `UPDATE turn_jobs
            SET status = 'running'
          WHERE tenant_id = ?
            AND job_id = ?
            AND status = 'queued'`,
        [resumeRow.tenant_id, turn.job_id],
      );
      await clearTurnLeaseStateTx(tx, {
        tenantId: resumeRow.tenant_id,
        turnId,
      });
      await recordTurnProgressTx(tx, {
        tenantId: resumeRow.tenant_id,
        turnId,
        at: nowIso,
        progress: {
          kind: "turn.resumed",
          approval_id: approval?.approval_id ?? null,
          approval_kind: approval?.kind ?? null,
        },
      });

      return turnId;
    });
  }

  async cancelTurn(
    turnId: string,
    reason?: string,
  ): Promise<"cancelled" | "already_terminal" | "not_found"> {
    const normalizedTurnId = turnId.trim();
    if (!normalizedTurnId) {
      return "not_found";
    }

    return await this.options.db.transaction(async (tx) => {
      const turn = await tx.get<TurnRow>(
        `SELECT tenant_id, job_id, conversation_key, status
           FROM turns
          WHERE turn_id = ?
          LIMIT 1`,
        [normalizedTurnId],
      );
      if (!turn) {
        return "not_found";
      }
      if (isTerminalTurnStatus(turn.status)) {
        return "already_terminal";
      }

      const cancelled = await this.cancelTurnTx(tx, normalizedTurnId, reason, turn);
      if (!cancelled) {
        const refreshed = await tx.get<Pick<TurnRow, "status">>(
          `SELECT status
             FROM turns
            WHERE tenant_id = ?
              AND turn_id = ?
            LIMIT 1`,
          [turn.tenant_id, normalizedTurnId],
        );
        return refreshed && isTerminalTurnStatus(refreshed.status)
          ? "already_terminal"
          : "not_found";
      }
      return "cancelled";
    });
  }

  private async cancelTurnTx(
    tx: SqlDb,
    turnId: string,
    reason: string | undefined,
    turn: TurnRow,
  ): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const detail = reason ? this.redactText(reason) : null;

    const turnUpdated = await tx.run(
      `UPDATE turns
          SET status = 'cancelled',
              finished_at = COALESCE(finished_at, ?),
              blocked_reason = COALESCE(blocked_reason, 'cancelled'),
              blocked_detail = COALESCE(blocked_detail, ?)
        WHERE tenant_id = ?
          AND turn_id = ?
          AND status IN ('queued', 'running', 'paused')`,
      [nowIso, detail, turn.tenant_id, turnId],
    );
    if (turnUpdated.changes !== 1) {
      return false;
    }
    await tx.run(
      `UPDATE turn_jobs
          SET status = 'cancelled'
        WHERE tenant_id = ?
          AND job_id = ?
          AND status IN ('queued', 'running')`,
      [turn.tenant_id, turn.job_id],
    );
    await clearTurnLeaseStateTx(tx, {
      tenantId: turn.tenant_id,
      turnId,
    });
    await setTurnCheckpointStateTx(tx, {
      tenantId: turn.tenant_id,
      turnId,
      checkpoint: null,
    });
    await recordTurnProgressTx(tx, {
      tenantId: turn.tenant_id,
      turnId,
      at: nowIso,
      progress: {
        kind: "turn.cancelled",
        reason: detail ?? "cancelled",
      },
    });
    await tx.run(
      `DELETE FROM conversation_leases
        WHERE tenant_id = ?
          AND conversation_key = ?`,
      [turn.tenant_id, turn.conversation_key],
    );
    await tx.run(
      `UPDATE resume_tokens
          SET revoked_at = ?
        WHERE tenant_id = ?
          AND turn_id = ?
          AND revoked_at IS NULL`,
      [nowIso, turn.tenant_id, turnId],
    );
    return true;
  }
}

export function createTurnController(options: TurnControllerOptions): TurnController {
  return new NativeTurnController(options);
}

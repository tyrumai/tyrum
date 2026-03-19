import type { SqlDb } from "../../statestore/types.js";

export type TelegramPollingStatus = "idle" | "running" | "error";

export interface TelegramPollingStateRow {
  tenant_id: string;
  account_key: string;
  bot_user_id: string | null;
  next_update_id: number | null;
  status: TelegramPollingStatus;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  last_polled_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
}

export class TelegramPollingStateDal {
  constructor(private readonly db: SqlDb) {}

  async get(input: {
    tenantId: string;
    accountKey: string;
  }): Promise<TelegramPollingStateRow | undefined> {
    return await this.db.get<TelegramPollingStateRow>(
      `SELECT *
       FROM telegram_polling_state
       WHERE tenant_id = ? AND account_key = ?`,
      [input.tenantId, input.accountKey],
    );
  }

  async listByTenant(tenantId: string): Promise<TelegramPollingStateRow[]> {
    return await this.db.all<TelegramPollingStateRow>(
      `SELECT *
       FROM telegram_polling_state
       WHERE tenant_id = ?
       ORDER BY account_key ASC`,
      [tenantId],
    );
  }

  async tryAcquire(input: {
    tenantId: string;
    accountKey: string;
    owner: string;
    nowMs: number;
    leaseTtlMs: number;
  }): Promise<boolean> {
    const leaseExpiresAt = input.nowMs + Math.max(1, input.leaseTtlMs);
    const nowIso = new Date(input.nowMs).toISOString();
    const inserted = await this.db.run(
      `INSERT INTO telegram_polling_state (
         tenant_id,
         account_key,
         bot_user_id,
         next_update_id,
         status,
         lease_owner,
         lease_expires_at_ms,
         last_polled_at,
         last_error_at,
         last_error_message,
         created_at,
         updated_at
       )
       VALUES (?, ?, NULL, NULL, 'idle', ?, ?, NULL, NULL, NULL, ?, ?)
       ON CONFLICT (tenant_id, account_key) DO NOTHING`,
      [input.tenantId, input.accountKey, input.owner, leaseExpiresAt, nowIso, nowIso],
    );
    if (inserted.changes > 0) {
      return true;
    }

    const updated = await this.db.run(
      `UPDATE telegram_polling_state
       SET lease_owner = ?,
           lease_expires_at_ms = ?,
           updated_at = ?
       WHERE tenant_id = ?
         AND account_key = ?
         AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ? OR lease_owner = ?)`,
      [
        input.owner,
        leaseExpiresAt,
        nowIso,
        input.tenantId,
        input.accountKey,
        input.nowMs,
        input.owner,
      ],
    );
    return updated.changes > 0;
  }

  async markRunning(input: {
    tenantId: string;
    accountKey: string;
    owner: string;
    botUserId?: string;
    nextUpdateId?: number | null;
    polledAt?: string;
  }): Promise<void> {
    const updatedAt = input.polledAt ?? new Date().toISOString();
    await this.db.run(
      `UPDATE telegram_polling_state
       SET status = 'running',
           bot_user_id = COALESCE(?, bot_user_id),
           next_update_id = COALESCE(?, next_update_id),
           last_polled_at = COALESCE(?, last_polled_at),
           last_error_at = NULL,
           last_error_message = NULL,
           updated_at = ?
       WHERE tenant_id = ?
         AND account_key = ?
         AND lease_owner = ?`,
      [
        input.botUserId ?? null,
        typeof input.nextUpdateId === "number" ? input.nextUpdateId : null,
        input.polledAt ?? null,
        updatedAt,
        input.tenantId,
        input.accountKey,
        input.owner,
      ],
    );
  }

  async renewLease(input: {
    tenantId: string;
    accountKey: string;
    owner: string;
    nowMs: number;
    leaseTtlMs: number;
  }): Promise<boolean> {
    const leaseExpiresAt = input.nowMs + Math.max(1, input.leaseTtlMs);
    const updatedAt = new Date(input.nowMs).toISOString();
    const updated = await this.db.run(
      `UPDATE telegram_polling_state
       SET lease_expires_at_ms = ?,
           updated_at = ?
       WHERE tenant_id = ?
         AND account_key = ?
         AND lease_owner = ?`,
      [leaseExpiresAt, updatedAt, input.tenantId, input.accountKey, input.owner],
    );
    return updated.changes > 0;
  }

  async updateCursor(input: {
    tenantId: string;
    accountKey: string;
    owner: string;
    botUserId?: string;
    nextUpdateId: number;
    polledAt: string;
  }): Promise<void> {
    await this.db.run(
      `UPDATE telegram_polling_state
       SET status = 'running',
           bot_user_id = COALESCE(?, bot_user_id),
           next_update_id = ?,
           last_polled_at = ?,
           last_error_at = NULL,
           last_error_message = NULL,
           updated_at = ?
       WHERE tenant_id = ?
         AND account_key = ?
         AND lease_owner = ?`,
      [
        input.botUserId ?? null,
        input.nextUpdateId,
        input.polledAt,
        input.polledAt,
        input.tenantId,
        input.accountKey,
        input.owner,
      ],
    );
  }

  async resetCursorForBot(input: {
    tenantId: string;
    accountKey: string;
    owner: string;
    botUserId: string;
    polledAt: string;
  }): Promise<void> {
    await this.db.run(
      `UPDATE telegram_polling_state
       SET bot_user_id = ?,
           next_update_id = NULL,
           status = 'running',
           last_polled_at = ?,
           last_error_at = NULL,
           last_error_message = NULL,
           updated_at = ?
       WHERE tenant_id = ?
         AND account_key = ?
         AND lease_owner = ?`,
      [
        input.botUserId,
        input.polledAt,
        input.polledAt,
        input.tenantId,
        input.accountKey,
        input.owner,
      ],
    );
  }

  async markError(input: {
    tenantId: string;
    accountKey: string;
    owner: string;
    occurredAt: string;
    message: string;
  }): Promise<void> {
    await this.db.run(
      `UPDATE telegram_polling_state
       SET status = 'error',
           last_error_at = ?,
           last_error_message = ?,
           updated_at = ?
       WHERE tenant_id = ?
         AND account_key = ?
         AND lease_owner = ?`,
      [
        input.occurredAt,
        input.message,
        input.occurredAt,
        input.tenantId,
        input.accountKey,
        input.owner,
      ],
    );
  }

  async release(input: { tenantId: string; accountKey: string; owner: string }): Promise<void> {
    const updatedAt = new Date().toISOString();
    await this.db.run(
      `UPDATE telegram_polling_state
       SET status = 'idle',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           updated_at = ?
       WHERE tenant_id = ?
         AND account_key = ?
         AND lease_owner = ?`,
      [updatedAt, input.tenantId, input.accountKey, input.owner],
    );
  }
}

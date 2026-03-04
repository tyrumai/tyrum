import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";

export type WatcherFiringStatus = "queued" | "processing" | "enqueued" | "failed";

export interface WatcherFiringRow {
  tenant_id: string;
  watcher_firing_id: string;
  watcher_id: string;
  scheduled_at_ms: number;
  status: WatcherFiringStatus;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  plan_id: string | null;
  job_id: string | null;
  run_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface RawWatcherFiringRow {
  tenant_id: string;
  watcher_firing_id: string;
  watcher_id: string;
  scheduled_at_ms: number;
  status: string;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  plan_id: string | null;
  job_id: string | null;
  run_id: string | null;
  error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawWatcherFiringRow): WatcherFiringRow {
  const status: WatcherFiringStatus =
    raw.status === "processing" || raw.status === "enqueued" || raw.status === "failed"
      ? raw.status
      : "queued";
  return {
    tenant_id: raw.tenant_id,
    watcher_firing_id: raw.watcher_firing_id,
    watcher_id: raw.watcher_id,
    scheduled_at_ms: raw.scheduled_at_ms,
    status,
    attempt: raw.attempt,
    lease_owner: raw.lease_owner,
    lease_expires_at_ms: raw.lease_expires_at_ms,
    plan_id: raw.plan_id,
    job_id: raw.job_id,
    run_id: raw.run_id,
    error: raw.error,
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export class WatcherFiringDal {
  constructor(private readonly db: SqlDb) {}

  async createIfAbsent(input: {
    tenantId: string;
    watcherId: string;
    scheduledAtMs: number;
    watcherFiringId?: string;
    planId?: string | null;
  }): Promise<{ row: WatcherFiringRow; created: boolean }> {
    const watcherFiringId = input.watcherFiringId?.trim() || randomUUID();
    const existing = await this.getById({ tenantId: input.tenantId, watcherFiringId });
    if (existing) {
      if (existing.watcher_id !== input.watcherId) {
        throw new Error(`watcher firing '${watcherFiringId}' already exists for another watcher`);
      }
      return { row: existing, created: false };
    }

    const nowIso = new Date().toISOString();
    try {
      const result = await this.db.run(
        `INSERT INTO watcher_firings (
           tenant_id,
           watcher_firing_id,
           watcher_id,
           scheduled_at_ms,
           status,
           plan_id,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
         ON CONFLICT (tenant_id, watcher_id, scheduled_at_ms) DO NOTHING`,
        [
          input.tenantId,
          watcherFiringId,
          input.watcherId,
          input.scheduledAtMs,
          input.planId ?? null,
          nowIso,
          nowIso,
        ],
      );
      if (result.changes === 1) {
        const createdRow = await this.getById({ tenantId: input.tenantId, watcherFiringId });
        if (!createdRow) {
          throw new Error("failed to create watcher firing");
        }
        return { row: createdRow, created: true };
      }

      const slot = await this.getByWatcherAndSlot({
        tenantId: input.tenantId,
        watcherId: input.watcherId,
        scheduledAtMs: input.scheduledAtMs,
      });
      if (!slot) {
        throw new Error("failed to create watcher firing");
      }
      return { row: slot, created: false };
    } catch (err) {
      const raced = await this.getById({ tenantId: input.tenantId, watcherFiringId });
      if (raced) {
        if (raced.watcher_id !== input.watcherId) {
          throw new Error(`watcher firing '${watcherFiringId}' already exists for another watcher`);
        }
        return { row: raced, created: false };
      }
      throw err;
    }
  }

  async getById(input: {
    tenantId: string;
    watcherFiringId: string;
  }): Promise<WatcherFiringRow | undefined> {
    const row = await this.db.get<RawWatcherFiringRow>(
      "SELECT * FROM watcher_firings WHERE tenant_id = ? AND watcher_firing_id = ?",
      [input.tenantId, input.watcherFiringId],
    );
    return row ? toRow(row) : undefined;
  }

  async getByWatcherAndSlot(input: {
    tenantId: string;
    watcherId: string;
    scheduledAtMs: number;
  }): Promise<WatcherFiringRow | undefined> {
    const row = await this.db.get<RawWatcherFiringRow>(
      `SELECT *
       FROM watcher_firings
       WHERE tenant_id = ? AND watcher_id = ? AND scheduled_at_ms = ?`,
      [input.tenantId, input.watcherId, input.scheduledAtMs],
    );
    return row ? toRow(row) : undefined;
  }

  async claimNext(input: {
    owner: string;
    nowMs: number;
    leaseTtlMs: number;
  }): Promise<WatcherFiringRow | undefined> {
    const leaseExpiresAt = input.nowMs + Math.max(1, input.leaseTtlMs);
    const nowIso = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const candidate = await tx.get<RawWatcherFiringRow>(
        `SELECT *
         FROM watcher_firings
         WHERE status = 'queued'
            OR (status = 'processing' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
         ORDER BY scheduled_at_ms ASC
         LIMIT 1`,
        [input.nowMs],
      );
      if (!candidate) return undefined;

      const updated = await tx.run(
        `UPDATE watcher_firings
         SET status = 'processing',
             lease_owner = ?,
             lease_expires_at_ms = ?,
             attempt = attempt + 1,
             updated_at = ?
         WHERE tenant_id = ? AND watcher_firing_id = ?
           AND (
             status = 'queued'
             OR (status = 'processing' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
           )`,
        [
          input.owner,
          leaseExpiresAt,
          nowIso,
          candidate.tenant_id,
          candidate.watcher_firing_id,
          input.nowMs,
        ],
      );
      if (updated.changes !== 1) return undefined;

      const claimed = await tx.get<RawWatcherFiringRow>(
        "SELECT * FROM watcher_firings WHERE tenant_id = ? AND watcher_firing_id = ?",
        [candidate.tenant_id, candidate.watcher_firing_id],
      );
      return claimed ? toRow(claimed) : undefined;
    });
  }

  async markEnqueued(input: {
    tenantId: string;
    watcherFiringId: string;
    owner: string;
    jobId?: string | null;
    runId?: string | null;
  }): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const res = await this.db.run(
      `UPDATE watcher_firings
       SET status = 'enqueued',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           job_id = ?,
           run_id = ?,
           error = NULL,
           updated_at = ?
       WHERE tenant_id = ?
         AND watcher_firing_id = ?
         AND lease_owner = ?
         AND status = 'processing'`,
      [
        input.jobId ?? null,
        input.runId ?? null,
        nowIso,
        input.tenantId,
        input.watcherFiringId,
        input.owner,
      ],
    );
    return res.changes === 1;
  }

  async markFailed(input: {
    tenantId: string;
    watcherFiringId: string;
    owner: string;
    error: string;
  }): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const res = await this.db.run(
      `UPDATE watcher_firings
       SET status = 'failed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           error = ?,
           updated_at = ?
       WHERE tenant_id = ?
         AND watcher_firing_id = ?
         AND lease_owner = ?
         AND status = 'processing'`,
      [input.error, nowIso, input.tenantId, input.watcherFiringId, input.owner],
    );
    return res.changes === 1;
  }
}

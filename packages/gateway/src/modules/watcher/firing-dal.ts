import type { SqlDb } from "../../statestore/types.js";

export type WatcherFiringStatus = "queued" | "processing" | "enqueued" | "failed";

export interface WatcherFiringRow {
  firing_id: string;
  watcher_id: number;
  plan_id: string;
  trigger_type: string;
  scheduled_at_ms: number;
  status: WatcherFiringStatus;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  job_id: string | null;
  run_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface RawWatcherFiringRow {
  firing_id: string;
  watcher_id: number;
  plan_id: string;
  trigger_type: string;
  scheduled_at_ms: number;
  status: string;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
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
    firing_id: raw.firing_id,
    watcher_id: raw.watcher_id,
    plan_id: raw.plan_id,
    trigger_type: raw.trigger_type,
    scheduled_at_ms: raw.scheduled_at_ms,
    status,
    attempt: raw.attempt,
    lease_owner: raw.lease_owner,
    lease_expires_at_ms: raw.lease_expires_at_ms,
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
    firingId: string;
    watcherId: number;
    planId: string;
    triggerType: string;
    scheduledAtMs: number;
  }): Promise<{ row: WatcherFiringRow; created: boolean }> {
    const nowIso = new Date().toISOString();
    const result = await this.db.run(
      `INSERT INTO watcher_firings (
         firing_id,
         watcher_id,
         plan_id,
         trigger_type,
         scheduled_at_ms,
         status,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
       ON CONFLICT DO NOTHING`,
      [
        input.firingId,
        input.watcherId,
        input.planId,
        input.triggerType,
        input.scheduledAtMs,
        nowIso,
        nowIso,
      ],
    );

    const row = await this.getById(input.firingId);
    if (row) return { row, created: result.changes === 1 };

    const existing = await this.getByWatcherAndSlot(input.watcherId, input.scheduledAtMs);
    if (!existing) {
      throw new Error("failed to create watcher firing");
    }
    return { row: existing, created: false };
  }

  async getById(firingId: string): Promise<WatcherFiringRow | undefined> {
    const row = await this.db.get<RawWatcherFiringRow>(
      "SELECT * FROM watcher_firings WHERE firing_id = ?",
      [firingId],
    );
    return row ? toRow(row) : undefined;
  }

  async getByWatcherAndSlot(watcherId: number, scheduledAtMs: number): Promise<WatcherFiringRow | undefined> {
    const row = await this.db.get<RawWatcherFiringRow>(
      "SELECT * FROM watcher_firings WHERE watcher_id = ? AND scheduled_at_ms = ?",
      [watcherId, scheduledAtMs],
    );
    return row ? toRow(row) : undefined;
  }

  async claimNext(input: { owner: string; nowMs: number; leaseTtlMs: number }): Promise<WatcherFiringRow | undefined> {
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
         WHERE firing_id = ?
           AND (
             status = 'queued'
             OR (status = 'processing' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
           )`,
        [input.owner, leaseExpiresAt, nowIso, candidate.firing_id, input.nowMs],
      );
      if (updated.changes !== 1) return undefined;

      const claimed = await tx.get<RawWatcherFiringRow>(
        "SELECT * FROM watcher_firings WHERE firing_id = ?",
        [candidate.firing_id],
      );
      return claimed ? toRow(claimed) : undefined;
    });
  }

  async markEnqueued(input: { firingId: string; owner: string; jobId?: string | null; runId?: string | null }): Promise<boolean> {
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
       WHERE firing_id = ? AND lease_owner = ? AND status = 'processing'`,
      [input.jobId ?? null, input.runId ?? null, nowIso, input.firingId, input.owner],
    );
    return res.changes === 1;
  }

  async markFailed(input: { firingId: string; owner: string; error: string }): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const res = await this.db.run(
      `UPDATE watcher_firings
       SET status = 'failed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           error = ?,
           updated_at = ?
       WHERE firing_id = ? AND lease_owner = ? AND status = 'processing'`,
      [input.error, nowIso, input.firingId, input.owner],
    );
    return res.changes === 1;
  }
}

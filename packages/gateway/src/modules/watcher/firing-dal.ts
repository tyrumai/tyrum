import type { SqlDb } from "../../statestore/types.js";

export type WatcherFiringStatus = "queued" | "processing" | "enqueued" | "failed";

function isExpectedWatcherFiringInsertConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const record = err as Record<string, unknown>;
  const code = typeof record["code"] === "string" ? record["code"] : "";
  const constraint = typeof record["constraint"] === "string" ? record["constraint"] : "";
  const detail = typeof record["detail"] === "string" ? record["detail"] : "";
  const message = typeof record["message"] === "string" ? record["message"] : "";

  // Postgres unique_violation
  if (code === "23505") {
    if (constraint === "watcher_firings_pkey" || constraint === "watcher_firings_watcher_id_scheduled_at_ms_key") {
      return true;
    }
    if (detail.includes("Key (firing_id)=") || detail.includes("Key (watcher_id, scheduled_at_ms)=")) {
      return true;
    }
    return false;
  }

  // SQLite constraint violations
  if (code.startsWith("SQLITE_CONSTRAINT")) {
    if (message.includes("watcher_firings.firing_id")) return true;
    if (message.includes("watcher_firings.watcher_id") && message.includes("watcher_firings.scheduled_at_ms")) {
      return true;
    }
    return false;
  }

  return false;
}

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
    let created = false;
    try {
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
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
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
      created = result.changes === 1;
    } catch (err) {
      if (!isExpectedWatcherFiringInsertConflict(err)) {
        throw err;
      }
    }

    const row = await this.getById(input.firingId);
    if (row) {
      if (row.watcher_id !== input.watcherId || row.plan_id !== input.planId || row.trigger_type !== input.triggerType) {
        throw new Error(`watcher firing '${input.firingId}' already exists with different attributes`);
      }
      return { row, created };
    }

    const existing = await this.getByWatcherAndSlot(input.watcherId, input.scheduledAtMs);
    if (!existing) {
      throw new Error("failed to create watcher firing");
    }
    if (existing.plan_id !== input.planId || existing.trigger_type !== input.triggerType) {
      throw new Error("watcher firing slot already occupied with different attributes");
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

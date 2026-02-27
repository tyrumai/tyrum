import type { SqlDb } from "../../statestore/types.js";

export type WorkSignalFiringStatus = "queued" | "processing" | "enqueued" | "failed";

export interface WorkSignalFiringRow {
  firing_id: string;
  signal_id: string;
  dedupe_key: string;
  status: WorkSignalFiringStatus;
  attempt: number;
  next_attempt_at_ms: number | null;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface RawWorkSignalFiringRow {
  firing_id: string;
  signal_id: string;
  dedupe_key: string;
  status: string;
  attempt: unknown;
  next_attempt_at_ms: unknown;
  lease_owner: string | null;
  lease_expires_at_ms: unknown;
  error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeMaybeMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeInt(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toRow(raw: RawWorkSignalFiringRow): WorkSignalFiringRow {
  const status: WorkSignalFiringStatus =
    raw.status === "processing" || raw.status === "enqueued" || raw.status === "failed"
      ? raw.status
      : "queued";
  return {
    firing_id: raw.firing_id,
    signal_id: raw.signal_id,
    dedupe_key: raw.dedupe_key,
    status,
    attempt: normalizeInt(raw.attempt),
    next_attempt_at_ms: normalizeMaybeMs(raw.next_attempt_at_ms),
    lease_owner: raw.lease_owner,
    lease_expires_at_ms: normalizeMaybeMs(raw.lease_expires_at_ms),
    error: raw.error,
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export class WorkSignalFiringDal {
  constructor(private readonly db: SqlDb) {}

  async getById(firingId: string): Promise<WorkSignalFiringRow | undefined> {
    const row = await this.db.get<RawWorkSignalFiringRow>(
      "SELECT * FROM work_signal_firings WHERE firing_id = ?",
      [firingId],
    );
    return row ? toRow(row) : undefined;
  }

  async getBySignalAndDedupeKey(
    signalId: string,
    dedupeKey: string,
  ): Promise<WorkSignalFiringRow | undefined> {
    const row = await this.db.get<RawWorkSignalFiringRow>(
      "SELECT * FROM work_signal_firings WHERE signal_id = ? AND dedupe_key = ?",
      [signalId, dedupeKey],
    );
    return row ? toRow(row) : undefined;
  }

  async createIfAbsent(input: {
    firingId: string;
    signalId: string;
    dedupeKey: string;
  }): Promise<{ row: WorkSignalFiringRow; created: boolean }> {
    const existing = await this.getById(input.firingId);
    if (existing) {
      if (existing.signal_id !== input.signalId || existing.dedupe_key !== input.dedupeKey) {
        throw new Error(
          `work signal firing '${input.firingId}' already exists with different attributes`,
        );
      }
      return { row: existing, created: false };
    }

    const nowIso = new Date().toISOString();
    try {
      const result = await this.db.run(
        `INSERT INTO work_signal_firings (
           firing_id,
           signal_id,
           dedupe_key,
           status,
           attempt,
           next_attempt_at_ms,
           lease_owner,
           lease_expires_at_ms,
           error,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, 'queued', 0, NULL, NULL, NULL, NULL, ?, ?)
         ON CONFLICT (signal_id, dedupe_key) DO NOTHING`,
        [input.firingId, input.signalId, input.dedupeKey, nowIso, nowIso],
      );

      if (result.changes === 1) {
        const createdRow = await this.getById(input.firingId);
        if (!createdRow) {
          throw new Error("failed to create work signal firing");
        }
        if (createdRow.signal_id !== input.signalId || createdRow.dedupe_key !== input.dedupeKey) {
          throw new Error(
            `work signal firing '${input.firingId}' already exists with different attributes`,
          );
        }
        return { row: createdRow, created: true };
      }

      const slot = await this.getBySignalAndDedupeKey(input.signalId, input.dedupeKey);
      if (!slot) {
        throw new Error("failed to create work signal firing");
      }
      return { row: slot, created: false };
    } catch (err) {
      const raced = await this.getById(input.firingId);
      if (raced) {
        if (raced.signal_id !== input.signalId || raced.dedupe_key !== input.dedupeKey) {
          throw new Error(
            `work signal firing '${input.firingId}' already exists with different attributes`,
          );
        }
        return { row: raced, created: false };
      }
      throw err;
    }
  }

  async claimNext(input: {
    owner: string;
    nowMs: number;
    leaseTtlMs: number;
  }): Promise<WorkSignalFiringRow | undefined> {
    const leaseExpiresAt = input.nowMs + Math.max(1, input.leaseTtlMs);
    const nowIso = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const candidate = await tx.get<RawWorkSignalFiringRow>(
        `SELECT *
         FROM work_signal_firings
         WHERE (
           status = 'queued'
           AND (next_attempt_at_ms IS NULL OR next_attempt_at_ms <= ?)
         ) OR (
           status = 'processing'
           AND lease_expires_at_ms IS NOT NULL
           AND lease_expires_at_ms <= ?
         )
         ORDER BY created_at ASC, firing_id ASC
         LIMIT 1`,
        [input.nowMs, input.nowMs],
      );
      if (!candidate) return undefined;

      const updated = await tx.run(
        `UPDATE work_signal_firings
         SET status = 'processing',
             lease_owner = ?,
             lease_expires_at_ms = ?,
             next_attempt_at_ms = NULL,
             attempt = attempt + 1,
             updated_at = ?
         WHERE firing_id = ?
           AND (
             (
               status = 'queued'
               AND (next_attempt_at_ms IS NULL OR next_attempt_at_ms <= ?)
             ) OR (
               status = 'processing'
               AND lease_expires_at_ms IS NOT NULL
               AND lease_expires_at_ms <= ?
             )
           )`,
        [input.owner, leaseExpiresAt, nowIso, candidate.firing_id, input.nowMs, input.nowMs],
      );
      if (updated.changes !== 1) return undefined;

      const claimed = await tx.get<RawWorkSignalFiringRow>(
        "SELECT * FROM work_signal_firings WHERE firing_id = ?",
        [candidate.firing_id],
      );
      return claimed ? toRow(claimed) : undefined;
    });
  }

  async markFailed(input: { firingId: string; owner: string; error: string }): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE work_signal_firings
       SET status = 'failed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           error = ?,
           updated_at = ?
       WHERE firing_id = ? AND lease_owner = ? AND status = 'processing'`,
      [input.error, nowIso, input.firingId, input.owner],
    );
  }

  async markRetryableFailure(input: {
    firingId: string;
    owner: string;
    nowMs: number;
    maxAttempts: number;
    error: string;
  }): Promise<void> {
    const firing = await this.getById(input.firingId);
    if (!firing) return;

    if (firing.attempt >= input.maxAttempts) {
      await this.markFailed({ firingId: input.firingId, owner: input.owner, error: input.error });
      return;
    }

    const baseMs = 1_000;
    const maxMs = 60_000;
    const backoffMs = Math.min(maxMs, baseMs * 2 ** Math.max(0, firing.attempt - 1));
    const nextAttemptAt = input.nowMs + backoffMs;
    const nowIso = new Date().toISOString();

    await this.db.run(
      `UPDATE work_signal_firings
       SET status = 'queued',
           next_attempt_at_ms = ?,
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           error = ?,
           updated_at = ?
       WHERE firing_id = ? AND lease_owner = ? AND status = 'processing'`,
      [nextAttemptAt, input.error, nowIso, input.firingId, input.owner],
    );
  }
}

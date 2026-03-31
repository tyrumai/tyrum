import type { ExecutionDb } from "./types.js";

type RawTime = string | Date | null;

type RawTurnRuntimeStateRow = {
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  checkpoint_json: string | null;
  last_progress_at: RawTime;
  last_progress_json: string | null;
};

export interface TurnRuntimeState {
  leaseOwner: string | null;
  leaseExpiresAtMs: number | null;
  checkpoint: unknown | null;
  lastProgressAt: string | null;
  lastProgress: Record<string, unknown> | null;
}

export interface TurnRuntimeStatePatch {
  leaseOwner?: string | null;
  leaseExpiresAtMs?: number | null;
  checkpoint?: unknown | null;
  lastProgressAt?: string | null;
  lastProgress?: Record<string, unknown> | null;
}

function normalizeMaybeTime(value: RawTime): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseStoredJson(raw: string | null): unknown | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function serializeStoredJson(value: unknown | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

export async function readTurnRuntimeState<TDb extends ExecutionDb<TDb>>(
  db: TDb,
  input: { tenantId: string; turnId: string },
): Promise<TurnRuntimeState | undefined> {
  const row = await db.get<RawTurnRuntimeStateRow>(
    `SELECT
       lease_owner,
       lease_expires_at_ms,
       checkpoint_json,
       last_progress_at,
       last_progress_json
     FROM turns
     WHERE tenant_id = ? AND turn_id = ?`,
    [input.tenantId, input.turnId],
  );
  if (!row) {
    return undefined;
  }

  const parsedProgress = parseStoredJson(row.last_progress_json);

  return {
    leaseOwner: row.lease_owner,
    leaseExpiresAtMs: row.lease_expires_at_ms,
    checkpoint: parseStoredJson(row.checkpoint_json),
    lastProgressAt: normalizeMaybeTime(row.last_progress_at),
    lastProgress: isRecord(parsedProgress) ? parsedProgress : null,
  };
}

export async function updateTurnRuntimeStateTx<TDb extends ExecutionDb<TDb>>(
  tx: TDb,
  input: {
    tenantId: string;
    turnId: string;
    patch: TurnRuntimeStatePatch;
  },
): Promise<void> {
  const set: string[] = [];
  const values: unknown[] = [];

  if (Object.hasOwn(input.patch, "leaseOwner")) {
    set.push("lease_owner = ?");
    values.push(input.patch.leaseOwner ?? null);
  }
  if (Object.hasOwn(input.patch, "leaseExpiresAtMs")) {
    set.push("lease_expires_at_ms = ?");
    values.push(input.patch.leaseExpiresAtMs ?? null);
  }
  if (Object.hasOwn(input.patch, "checkpoint")) {
    set.push("checkpoint_json = ?");
    values.push(serializeStoredJson(input.patch.checkpoint ?? null));
  }
  if (Object.hasOwn(input.patch, "lastProgressAt")) {
    set.push("last_progress_at = ?");
    values.push(input.patch.lastProgressAt ?? null);
  }
  if (Object.hasOwn(input.patch, "lastProgress")) {
    set.push("last_progress_json = ?");
    values.push(serializeStoredJson(input.patch.lastProgress ?? null));
  }

  if (set.length === 0) {
    return;
  }

  await tx.run(
    `UPDATE turns
     SET ${set.join(", ")}
     WHERE tenant_id = ? AND turn_id = ?`,
    [...values, input.tenantId, input.turnId],
  );
}

export async function setTurnLeaseStateTx<TDb extends ExecutionDb<TDb>>(
  tx: TDb,
  input: {
    tenantId: string;
    turnId: string;
    owner: string | null;
    expiresAtMs: number | null;
  },
): Promise<void> {
  await updateTurnRuntimeStateTx(tx, {
    tenantId: input.tenantId,
    turnId: input.turnId,
    patch: {
      leaseOwner: input.owner,
      leaseExpiresAtMs: input.expiresAtMs,
    },
  });
}

export async function clearTurnLeaseStateTx<TDb extends ExecutionDb<TDb>>(
  tx: TDb,
  input: {
    tenantId: string;
    turnId: string;
  },
): Promise<void> {
  await setTurnLeaseStateTx(tx, {
    tenantId: input.tenantId,
    turnId: input.turnId,
    owner: null,
    expiresAtMs: null,
  });
}

export async function setTurnCheckpointStateTx<TDb extends ExecutionDb<TDb>>(
  tx: TDb,
  input: {
    tenantId: string;
    turnId: string;
    checkpoint: unknown | null;
  },
): Promise<void> {
  await updateTurnRuntimeStateTx(tx, {
    tenantId: input.tenantId,
    turnId: input.turnId,
    patch: { checkpoint: input.checkpoint ?? null },
  });
}

export async function recordTurnProgressTx<TDb extends ExecutionDb<TDb>>(
  tx: TDb,
  input: {
    tenantId: string;
    turnId: string;
    at: string | null;
    progress: Record<string, unknown> | null;
  },
): Promise<void> {
  await updateTurnRuntimeStateTx(tx, {
    tenantId: input.tenantId,
    turnId: input.turnId,
    patch: {
      lastProgressAt: input.at,
      lastProgress: input.progress,
    },
  });
}

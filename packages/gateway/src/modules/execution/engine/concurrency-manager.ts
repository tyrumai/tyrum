import type {
  ActionPrimitive as ActionPrimitiveT,
  ClientCapability as ClientCapabilityT,
} from "@tyrum/contracts";
import type { SqlDb } from "../../../statestore/types.js";
import { releaseWorkspaceLeaseTx } from "../../workspace/lease.js";
import type {
  ExecutionConcurrencyLimits,
  StepExecutionContext,
  StepExecutor,
  StepResult,
} from "./types.js";

export async function executeWithTimeout(
  executor: StepExecutor,
  action: ActionPrimitiveT,
  planId: string,
  stepIndex: number,
  timeoutMs: number,
  context: StepExecutionContext,
): Promise<StepResult> {
  try {
    return await executor.execute(action, planId, stepIndex, timeoutMs, context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export async function releaseConcurrencySlotsTx(
  tx: SqlDb,
  tenantId: string,
  attemptId: string,
  nowIso: string,
  concurrencyLimits?: ExecutionConcurrencyLimits,
): Promise<void> {
  if (!attemptId) return;
  if (!concurrencyLimits) return;
  await tx.run(
    `UPDATE concurrency_slots
     SET lease_owner = NULL,
         lease_expires_at_ms = NULL,
         attempt_id = NULL,
         updated_at = ?
     WHERE tenant_id = ? AND attempt_id = ?`,
    [nowIso, tenantId, attemptId],
  );
}

export async function ensureConcurrencySlotsTx(
  tx: SqlDb,
  tenantId: string,
  scope: string,
  scopeId: string,
  limit: number,
): Promise<void> {
  for (let slot = 0; slot < limit; slot += 1) {
    await tx.run(
      `INSERT INTO concurrency_slots (tenant_id, scope, scope_id, slot)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, scope, scope_id, slot) DO NOTHING`,
      [tenantId, scope, scopeId, slot],
    );
  }
}

export async function tryAcquireConcurrencySlotTx(
  tx: SqlDb,
  opts: {
    tenantId: string;
    scope: string;
    scopeId: string;
    limit: number;
    attemptId: string;
    owner: string;
    nowMs: number;
    nowIso: string;
    ttlMs: number;
  },
): Promise<boolean> {
  if (opts.limit <= 0) return false;

  await ensureConcurrencySlotsTx(tx, opts.tenantId, opts.scope, opts.scopeId, opts.limit);

  const expiresAtMs = opts.nowMs + Math.max(1, opts.ttlMs);
  const maxTries = Math.min(10, Math.max(1, opts.limit));

  for (let i = 0; i < maxTries; i += 1) {
    const updated = await tx.run(
      `UPDATE concurrency_slots
       SET lease_owner = ?,
           lease_expires_at_ms = ?,
           attempt_id = ?,
           updated_at = ?
       WHERE tenant_id = ? AND scope = ? AND scope_id = ?
         AND slot IN (
           SELECT slot
           FROM concurrency_slots
           WHERE tenant_id = ? AND scope = ? AND scope_id = ?
             AND slot < ?
             AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)
           ORDER BY COALESCE(lease_expires_at_ms, 0) ASC, slot ASC
           LIMIT 1
         )
         AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)`,
      [
        opts.owner,
        expiresAtMs,
        opts.attemptId,
        opts.nowIso,
        opts.tenantId,
        opts.scope,
        opts.scopeId,
        opts.tenantId,
        opts.scope,
        opts.scopeId,
        opts.limit,
        opts.nowMs,
        opts.nowMs,
      ],
    );
    if (updated.changes === 1) {
      return true;
    }
  }

  return false;
}

export async function tryAcquireConcurrencyForAttemptTx(
  tx: SqlDb,
  opts: {
    tenantId: string;
    attemptId: string;
    owner: string;
    nowMs: number;
    nowIso: string;
    ttlMs: number;
    agentId: string;
    capability?: ClientCapabilityT;
  },
  concurrencyLimits?: ExecutionConcurrencyLimits,
): Promise<boolean> {
  const limits = concurrencyLimits;
  if (!limits) return true;

  const globalLimit = limits.global;
  const perAgentLimit = limits.perAgent;
  const capabilityLimit =
    opts.capability && limits.perCapability ? limits.perCapability[opts.capability] : undefined;

  if (globalLimit === undefined && perAgentLimit === undefined && capabilityLimit === undefined) {
    return true;
  }

  const claimScope = async (
    scope: string,
    scopeId: string,
    limit: number | undefined,
  ): Promise<boolean> => {
    if (limit === undefined) return true;
    return await tryAcquireConcurrencySlotTx(tx, {
      tenantId: opts.tenantId,
      scope,
      scopeId,
      limit,
      attemptId: opts.attemptId,
      owner: opts.owner,
      nowMs: opts.nowMs,
      nowIso: opts.nowIso,
      ttlMs: opts.ttlMs,
    });
  };

  if (!(await claimScope("global", "global", globalLimit))) {
    await releaseConcurrencySlotsTx(
      tx,
      opts.tenantId,
      opts.attemptId,
      opts.nowIso,
      concurrencyLimits,
    );
    return false;
  }

  if (!(await claimScope("agent", opts.agentId, perAgentLimit))) {
    await releaseConcurrencySlotsTx(
      tx,
      opts.tenantId,
      opts.attemptId,
      opts.nowIso,
      concurrencyLimits,
    );
    return false;
  }

  if (opts.capability && capabilityLimit !== undefined) {
    if (!(await claimScope("capability", opts.capability, capabilityLimit))) {
      await releaseConcurrencySlotsTx(
        tx,
        opts.tenantId,
        opts.attemptId,
        opts.nowIso,
        concurrencyLimits,
      );
      return false;
    }
  }

  return true;
}

export async function tryAcquireLaneLease(
  db: SqlDb,
  opts: {
    tenantId: string;
    key: string;
    lane: string;
    owner: string;
    nowMs: number;
    ttlMs: number;
  },
): Promise<boolean> {
  const expiresAt = opts.nowMs + Math.max(1, opts.ttlMs);
  return await db.transaction(async (tx) => {
    const inserted = await tx.run(
      `INSERT INTO conversation_leases (
         tenant_id,
         conversation_key,
         lane,
         lease_owner,
         lease_expires_at_ms
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_key, lane) DO NOTHING`,
      [opts.tenantId, opts.key, opts.lane, opts.owner, expiresAt],
    );
    if (inserted.changes === 1) return true;

    const updated = await tx.run(
      `UPDATE conversation_leases
       SET lease_owner = ?, lease_expires_at_ms = ?
       WHERE tenant_id = ? AND conversation_key = ? AND lane = ?
         AND (lease_expires_at_ms <= ? OR lease_owner = ?)`,
      [opts.owner, expiresAt, opts.tenantId, opts.key, opts.lane, opts.nowMs, opts.owner],
    );
    return updated.changes === 1;
  });
}

export async function releaseLaneLeaseTx(
  tx: SqlDb,
  opts: {
    tenantId: string;
    key: string;
    lane: string;
    owner: string;
  },
): Promise<void> {
  await tx.run(
    `DELETE FROM conversation_leases
     WHERE tenant_id = ? AND conversation_key = ? AND lane = ? AND lease_owner = ?`,
    [opts.tenantId, opts.key, opts.lane, opts.owner],
  );
}

export async function releaseLaneAndWorkspaceLeasesTx(
  tx: SqlDb,
  opts: {
    tenantId: string;
    key: string;
    lane: string;
    workspaceId: string;
    owner: string;
  },
): Promise<void> {
  await releaseLaneLeaseTx(tx, {
    tenantId: opts.tenantId,
    key: opts.key,
    lane: opts.lane,
    owner: opts.owner,
  });
  await releaseWorkspaceLeaseTx(tx, {
    tenantId: opts.tenantId,
    workspaceId: opts.workspaceId,
    owner: opts.owner,
  });
}

export async function touchLaneLeaseTx(
  tx: SqlDb,
  opts: {
    tenantId: string;
    key: string;
    lane: string;
    owner: string;
    expiresAtMs: number;
  },
): Promise<void> {
  await tx.run(
    `UPDATE conversation_leases
     SET lease_expires_at_ms = ?
     WHERE tenant_id = ? AND conversation_key = ? AND lane = ? AND lease_owner = ?`,
    [opts.expiresAtMs, opts.tenantId, opts.key, opts.lane, opts.owner],
  );
}

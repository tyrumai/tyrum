import type { SqlDb } from "../../statestore/types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function tryAcquireWorkspaceLeaseTx(
  tx: SqlDb,
  opts: {
    tenantId: string;
    workspaceId: string;
    owner: string;
    nowMs: number;
    ttlMs: number;
  },
): Promise<boolean> {
  const expiresAtMs = opts.nowMs + Math.max(1, opts.ttlMs);

  const inserted = await tx.run(
    `INSERT INTO workspace_leases (tenant_id, workspace_id, lease_owner, lease_expires_at_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (tenant_id, workspace_id) DO NOTHING`,
    [opts.tenantId, opts.workspaceId, opts.owner, expiresAtMs],
  );
  if (inserted.changes === 1) return true;

  const updated = await tx.run(
    `UPDATE workspace_leases
     SET lease_owner = ?, lease_expires_at_ms = ?
     WHERE tenant_id = ? AND workspace_id = ?
       AND (lease_expires_at_ms <= ? OR lease_owner = ?)`,
    [opts.owner, expiresAtMs, opts.tenantId, opts.workspaceId, opts.nowMs, opts.owner],
  );
  return updated.changes === 1;
}

export async function tryAcquireWorkspaceLease(
  db: SqlDb,
  opts: {
    tenantId: string;
    workspaceId: string;
    owner: string;
    nowMs: number;
    ttlMs: number;
  },
): Promise<boolean> {
  return await db.transaction(async (tx) => await tryAcquireWorkspaceLeaseTx(tx, opts));
}

export async function acquireWorkspaceLease(
  db: SqlDb,
  opts: {
    tenantId: string;
    workspaceId: string;
    owner: string;
    ttlMs: number;
    /** Maximum time to wait for the lease (default: 0 = no wait). */
    waitMs?: number;
    /** Poll interval while waiting (default: 50ms). */
    pollMs?: number;
    clock?: () => number;
  },
): Promise<boolean> {
  const clock = opts.clock ?? Date.now;
  const waitMs = Math.max(0, Math.floor(opts.waitMs ?? 0));
  const pollMs = Math.max(10, Math.floor(opts.pollMs ?? 50));
  const deadlineMs = clock() + waitMs;

  for (;;) {
    const nowMs = clock();
    const ok = await tryAcquireWorkspaceLease(db, {
      tenantId: opts.tenantId,
      workspaceId: opts.workspaceId,
      owner: opts.owner,
      nowMs,
      ttlMs: opts.ttlMs,
    });
    if (ok) return true;

    if (waitMs === 0 || nowMs >= deadlineMs) {
      return false;
    }

    const remainingMs = Math.max(0, deadlineMs - nowMs);
    await sleep(Math.min(pollMs, remainingMs));
  }
}

export async function releaseWorkspaceLease(
  db: SqlDb,
  opts: {
    tenantId: string;
    workspaceId: string;
    owner: string;
  },
): Promise<void> {
  await releaseWorkspaceLeaseTx(db, opts);
}

export async function releaseWorkspaceLeaseTx(
  tx: SqlDb,
  opts: {
    tenantId: string;
    workspaceId: string;
    owner: string;
  },
): Promise<void> {
  await tx.run(
    `DELETE FROM workspace_leases
     WHERE tenant_id = ? AND workspace_id = ? AND lease_owner = ?`,
    [opts.tenantId, opts.workspaceId, opts.owner],
  );
}

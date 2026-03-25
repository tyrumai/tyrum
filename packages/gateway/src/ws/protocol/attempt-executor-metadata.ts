import type { ProtocolDeps } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function upsertAttemptExecutorMetadata(
  deps: ProtocolDeps,
  attemptId: string,
  executor: { tenantId: string; nodeId: string; connectionId: string; edgeId?: string },
): Promise<void> {
  const db = deps.db;
  if (!db) return;
  if (!attemptId || attemptId.trim().length === 0) return;
  if (!executor.tenantId || executor.tenantId.trim().length === 0) return;
  if (!executor.nodeId || executor.nodeId.trim().length === 0) return;
  if (!executor.connectionId || executor.connectionId.trim().length === 0) return;

  try {
    const row = await db.get<{ metadata_json: string | null }>(
      "SELECT metadata_json FROM execution_attempts WHERE tenant_id = ? AND attempt_id = ?",
      [executor.tenantId, attemptId],
    );
    if (!row) return;

    let meta: Record<string, unknown> = {};
    if (typeof row.metadata_json === "string" && row.metadata_json.trim().length > 0) {
      try {
        const parsed = JSON.parse(row.metadata_json) as unknown;
        if (isObject(parsed)) meta = parsed;
      } catch (_err) {
        void _err;
        // Intentional: malformed metadata_json should not break WS dispatch metadata persistence.
      }
    }

    const executorMeta: Record<string, unknown> = {
      kind: "node",
      node_id: executor.nodeId,
      connection_id: executor.connectionId,
    };
    if (typeof executor.edgeId === "string" && executor.edgeId.trim().length > 0) {
      executorMeta["edge_id"] = executor.edgeId;
    }

    meta["executor"] = executorMeta;
    await db.run(
      "UPDATE execution_attempts SET metadata_json = ? WHERE tenant_id = ? AND attempt_id = ?",
      [JSON.stringify(meta), executor.tenantId, attemptId],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.warn("execution.attempt.executor_metadata_persist_failed", {
      attempt_id: attemptId,
      tenant_id: executor.tenantId,
      node_id: executor.nodeId,
      connection_id: executor.connectionId,
      edge_id: executor.edgeId,
      error: message,
    });
  }
}

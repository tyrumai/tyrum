import type { SubagentStatus, WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type * as DalHelpers from "./dal-helpers.js";

export async function updateSubagentRow(params: {
  db: SqlDb;
  scope: WorkScope;
  subagent_id: string;
  patch: {
    status?: SubagentStatus;
    desktop_environment_id?: string | null;
    attached_node_id?: string | null;
    close_reason?: string | null;
    closed_at?: string | null;
    last_heartbeat_at?: string | null;
  };
  updatedAtIso: string;
}): Promise<DalHelpers.RawSubagentRow | undefined> {
  const set: string[] = ["updated_at = ?"];
  const values: unknown[] = [params.updatedAtIso];

  if (params.patch.status !== undefined) {
    set.push("status = ?");
    values.push(params.patch.status);
  }
  if (params.patch.desktop_environment_id !== undefined) {
    set.push("desktop_environment_id = ?");
    values.push(params.patch.desktop_environment_id);
  }
  if (params.patch.attached_node_id !== undefined) {
    set.push("attached_node_id = ?");
    values.push(params.patch.attached_node_id);
  }
  if (params.patch.close_reason !== undefined) {
    set.push("close_reason = ?");
    values.push(params.patch.close_reason);
  }
  if (params.patch.closed_at !== undefined) {
    set.push("closed_at = ?");
    values.push(params.patch.closed_at);
  }
  if (params.patch.last_heartbeat_at !== undefined) {
    set.push("last_heartbeat_at = ?");
    values.push(params.patch.last_heartbeat_at);
  }

  return await params.db.get<DalHelpers.RawSubagentRow>(
    `UPDATE subagents
     SET ${set.join(", ")}
     WHERE tenant_id = ?
       AND agent_id = ?
       AND workspace_id = ?
       AND subagent_id = ?
     RETURNING *`,
    [
      ...values,
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
      params.subagent_id,
    ],
  );
}

export async function deleteTerminatedSubagentsBefore(params: {
  db: SqlDb;
  scope: WorkScope;
  closedBeforeIso: string;
  limit: number;
}): Promise<number> {
  const rows = await params.db.all<{ subagent_id: string }>(
    `SELECT subagent_id
     FROM subagents
     WHERE tenant_id = ?
       AND agent_id = ?
       AND workspace_id = ?
       AND status IN ('closed', 'failed')
       AND closed_at IS NOT NULL
       AND closed_at <= ?
       AND desktop_environment_id IS NULL
     ORDER BY closed_at ASC, subagent_id ASC
     LIMIT ?`,
    [
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
      params.closedBeforeIso,
      params.limit,
    ],
  );
  if (rows.length === 0) {
    return 0;
  }

  const placeholders = rows.map(() => "?").join(", ");
  const result = await params.db.run(
    `DELETE FROM subagents
     WHERE tenant_id = ?
       AND agent_id = ?
       AND workspace_id = ?
       AND subagent_id IN (${placeholders})`,
    [
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
      ...rows.map((row) => row.subagent_id),
    ],
  );
  return result.changes ?? 0;
}

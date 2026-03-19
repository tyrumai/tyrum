import type { WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

import type * as DalHelpers from "./dal-helpers.js";

export class WorkboardScopeActivityDal {
  constructor(private readonly db: SqlDb) {}

  async upsertScopeActivity(params: {
    scope: WorkScope;
    last_active_session_key: string;
    updated_at_ms?: number;
  }): Promise<DalHelpers.WorkScopeActivityRow> {
    const updatedAtMs = params.updated_at_ms ?? Date.now();
    const row = await this.db.get<DalHelpers.RawScopeActivityRow>(
      `INSERT INTO work_scope_activity (
         tenant_id,
         agent_id,
         workspace_id,
         last_active_session_key,
         updated_at_ms
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, agent_id, workspace_id)
       DO UPDATE SET
         last_active_session_key = excluded.last_active_session_key,
         updated_at_ms = excluded.updated_at_ms
       WHERE excluded.updated_at_ms > work_scope_activity.updated_at_ms
       RETURNING *`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.last_active_session_key,
        updatedAtMs,
      ],
    );
    if (row) return row;

    const existing = await this.getScopeActivity({ scope: params.scope });
    if (!existing) {
      throw new Error("work scope activity upsert failed");
    }
    return existing;
  }

  async getScopeActivity(params: {
    scope: WorkScope;
  }): Promise<DalHelpers.WorkScopeActivityRow | undefined> {
    return await this.db.get<DalHelpers.RawScopeActivityRow>(
      `SELECT *
       FROM work_scope_activity
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?`,
      [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id],
    );
  }
}

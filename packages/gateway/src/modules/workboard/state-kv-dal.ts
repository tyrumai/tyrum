import type {
  AgentStateKVEntry,
  WorkItemStateKVEntry,
  WorkStateKVKey,
  WorkStateKVScopeIds,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

import type { GetItemFn } from "./dal-deps.js";
import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";

type WorkboardStateKvDalDependencies = {
  db: SqlDb;
  getItem: GetItemFn;
};

export class WorkboardStateKvDal {
  constructor(private readonly deps: WorkboardStateKvDalDependencies) {}

  async getStateKv(params: {
    scope: WorkStateKVScopeIds;
    key: WorkStateKVKey;
  }): Promise<(AgentStateKVEntry | WorkItemStateKVEntry) | undefined> {
    if (params.scope.kind === "agent") {
      const row = await this.deps.db.get<DalHelpers.RawKvRow>(
        `SELECT *
         FROM agent_state_kv
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND key = ?`,
        [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id, params.key],
      );
      return row ? (dalHelpers.toKvEntry(row) as AgentStateKVEntry) : undefined;
    }

    const row = await this.deps.db.get<DalHelpers.RawKvRow>(
      `SELECT *
       FROM work_item_state_kv
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND key = ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.scope.work_item_id,
        params.key,
      ],
    );
    return row
      ? (dalHelpers.toKvEntry({
          ...row,
          work_item_id: params.scope.work_item_id,
        }) as WorkItemStateKVEntry)
      : undefined;
  }

  async listStateKv(params: {
    scope: WorkStateKVScopeIds;
    prefix?: string;
  }): Promise<{ entries: (AgentStateKVEntry | WorkItemStateKVEntry)[] }> {
    const where: string[] = ["tenant_id = ?", "agent_id = ?", "workspace_id = ?"];
    const values: unknown[] = [
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
    ];

    if (params.scope.kind === "work_item") {
      where.push("work_item_id = ?");
      values.push(params.scope.work_item_id);
    }

    if (params.prefix) {
      where.push("key LIKE ? ESCAPE '\\'");
      values.push(`${dalHelpers.escapeLikePattern(params.prefix)}%`);
    }

    const table = params.scope.kind === "agent" ? "agent_state_kv" : "work_item_state_kv";
    const rows = await this.deps.db.all<DalHelpers.RawKvRow>(
      `SELECT *
       FROM ${table}
       WHERE ${where.join(" AND ")}
       ORDER BY key ASC`,
      values,
    );

    const entries = rows.map((row) =>
      dalHelpers.toKvEntry(
        params.scope.kind === "work_item"
          ? { ...row, work_item_id: params.scope.work_item_id }
          : row,
      ),
    );
    return { entries };
  }

  async setStateKv(params: {
    scope: WorkStateKVScopeIds;
    key: WorkStateKVKey;
    value_json: unknown;
    provenance_json?: unknown;
    updatedByRunId?: string;
    updatedAtIso?: string;
  }): Promise<AgentStateKVEntry | WorkItemStateKVEntry> {
    const updatedAtIso = params.updatedAtIso ?? new Date().toISOString();
    const valueJson = JSON.stringify(params.value_json ?? null);
    const provenanceJson =
      params.provenance_json === undefined ? null : JSON.stringify(params.provenance_json);
    const updatedByRunId = params.updatedByRunId ?? null;

    if (params.scope.kind === "agent") {
      return await this.upsertAgentEntry(
        params.scope,
        params.key,
        valueJson,
        updatedAtIso,
        updatedByRunId,
        provenanceJson,
      );
    }

    const item = await this.deps.getItem({
      scope: params.scope,
      work_item_id: params.scope.work_item_id,
    });
    if (!item) {
      throw new Error("work_item_id is outside scope");
    }

    return await this.upsertWorkItemEntry(
      params.scope,
      params.key,
      valueJson,
      updatedAtIso,
      updatedByRunId,
      provenanceJson,
    );
  }

  private async upsertAgentEntry(
    scope: Extract<WorkStateKVScopeIds, { kind: "agent" }>,
    key: WorkStateKVKey,
    valueJson: string,
    updatedAtIso: string,
    updatedByRunId: string | null,
    provenanceJson: string | null,
  ): Promise<AgentStateKVEntry> {
    const row = await this.deps.db.get<DalHelpers.RawKvRow>(
      `INSERT INTO agent_state_kv (
         tenant_id,
         agent_id,
         workspace_id,
         key,
         value_json,
         updated_at,
         updated_by_run_id,
         provenance_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, agent_id, workspace_id, key)
       DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at,
         updated_by_run_id = excluded.updated_by_run_id,
         provenance_json = excluded.provenance_json
       RETURNING *`,
      [
        scope.tenant_id,
        scope.agent_id,
        scope.workspace_id,
        key,
        valueJson,
        updatedAtIso,
        updatedByRunId,
        provenanceJson,
      ],
    );
    if (!row) {
      throw new Error("agent state kv upsert failed");
    }
    return dalHelpers.toKvEntry(row) as AgentStateKVEntry;
  }

  private async upsertWorkItemEntry(
    scope: Extract<WorkStateKVScopeIds, { kind: "work_item" }>,
    key: WorkStateKVKey,
    valueJson: string,
    updatedAtIso: string,
    updatedByRunId: string | null,
    provenanceJson: string | null,
  ): Promise<WorkItemStateKVEntry> {
    const row = await this.deps.db.get<DalHelpers.RawKvRow>(
      `INSERT INTO work_item_state_kv (
         tenant_id,
         agent_id,
         workspace_id,
         work_item_id,
         key,
         value_json,
         updated_at,
         updated_by_run_id,
         provenance_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, agent_id, workspace_id, work_item_id, key)
       DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at,
         updated_by_run_id = excluded.updated_by_run_id,
         provenance_json = excluded.provenance_json
       RETURNING *`,
      [
        scope.tenant_id,
        scope.agent_id,
        scope.workspace_id,
        scope.work_item_id,
        key,
        valueJson,
        updatedAtIso,
        updatedByRunId,
        provenanceJson,
      ],
    );
    if (!row) {
      throw new Error("work item state kv upsert failed");
    }
    return dalHelpers.toKvEntry({
      ...row,
      work_item_id: scope.work_item_id,
    }) as WorkItemStateKVEntry;
  }

  async deleteStateKv(params: {
    scope: WorkStateKVScopeIds;
    key: WorkStateKVKey;
  }): Promise<(AgentStateKVEntry | WorkItemStateKVEntry) | undefined> {
    if (params.scope.kind === "agent") {
      const row = await this.deps.db.get<DalHelpers.RawKvRow>(
        `DELETE FROM agent_state_kv
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND key = ?
         RETURNING *`,
        [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id, params.key],
      );
      return row ? (dalHelpers.toKvEntry(row) as AgentStateKVEntry) : undefined;
    }

    const row = await this.deps.db.get<DalHelpers.RawKvRow>(
      `DELETE FROM work_item_state_kv
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND key = ?
       RETURNING *`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.scope.work_item_id,
        params.key,
      ],
    );
    return row
      ? (dalHelpers.toKvEntry({
          ...row,
          work_item_id: params.scope.work_item_id,
        }) as WorkItemStateKVEntry)
      : undefined;
  }
}

import type { SqlDb } from "../../statestore/types.js";

export interface ExecutionProfileModelAssignmentRow {
  tenant_id: string;
  execution_profile_id: string;
  preset_key: string;
  updated_at: string;
}

interface RawExecutionProfileModelAssignmentRow {
  tenant_id: string;
  execution_profile_id: string;
  preset_key: string;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawExecutionProfileModelAssignmentRow): ExecutionProfileModelAssignmentRow {
  return {
    tenant_id: raw.tenant_id,
    execution_profile_id: raw.execution_profile_id,
    preset_key: raw.preset_key,
    updated_at: normalizeTime(raw.updated_at),
  };
}

export class ExecutionProfileModelAssignmentDal {
  constructor(private readonly db: SqlDb) {}

  protected createTxDal(tx: SqlDb): ExecutionProfileModelAssignmentDal {
    return new ExecutionProfileModelAssignmentDal(tx);
  }

  async list(input: { tenantId: string }): Promise<ExecutionProfileModelAssignmentRow[]> {
    const rows = await this.db.all<RawExecutionProfileModelAssignmentRow>(
      `SELECT *
       FROM execution_profile_model_assignments
       WHERE tenant_id = ?
       ORDER BY execution_profile_id ASC`,
      [input.tenantId],
    );
    return rows.map(toRow);
  }

  async getByProfileId(input: {
    tenantId: string;
    executionProfileId: string;
  }): Promise<ExecutionProfileModelAssignmentRow | undefined> {
    const row = await this.db.get<RawExecutionProfileModelAssignmentRow>(
      `SELECT *
       FROM execution_profile_model_assignments
       WHERE tenant_id = ? AND execution_profile_id = ?
       LIMIT 1`,
      [input.tenantId, input.executionProfileId],
    );
    return row ? toRow(row) : undefined;
  }

  async setMany(input: {
    tenantId: string;
    assignments: Array<{ executionProfileId: string; presetKey: string | null }>;
  }): Promise<ExecutionProfileModelAssignmentRow[]> {
    return await this.db.transaction(async (tx) => {
      const dal = tx === this.db ? this : this.createTxDal(tx);
      await dal.setManyTx(input);
      return await dal.list({ tenantId: input.tenantId });
    });
  }

  async setManyTx(input: {
    tenantId: string;
    assignments: Array<{ executionProfileId: string; presetKey: string | null }>;
  }): Promise<void> {
    const nowIso = new Date().toISOString();
    for (const assignment of input.assignments) {
      if (assignment.presetKey === null) {
        await this.db.run(
          `DELETE FROM execution_profile_model_assignments
           WHERE tenant_id = ? AND execution_profile_id = ?`,
          [input.tenantId, assignment.executionProfileId],
        );
        continue;
      }
      await this.db.run(
        `INSERT INTO execution_profile_model_assignments (
           tenant_id,
           execution_profile_id,
           preset_key,
           updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT (tenant_id, execution_profile_id) DO UPDATE SET
           preset_key = excluded.preset_key,
           updated_at = excluded.updated_at`,
        [input.tenantId, assignment.executionProfileId, assignment.presetKey, nowIso],
      );
    }
  }
}

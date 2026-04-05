import {
  DispatchRecord,
  type ActionPrimitive,
  type DispatchRecord as DispatchRecordT,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

type RawDispatchRecordRow = {
  dispatch_id: string;
  turn_id: string | null;
  turn_item_id: string | null;
  workflow_run_step_id: string | null;
  requested_node_id: string | null;
  selected_node_id: string | null;
  capability: string;
  action_json: string;
  task_id: string | null;
  status: string;
  result_json: string | null;
  evidence_json: string | null;
  error: string | null;
  policy_snapshot_id: string | null;
  connection_id: string | null;
  edge_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
};

function normalizeDateTime(value: string | Date | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) {
    return null;
  }
  return JSON.parse(raw) as unknown;
}

function toDispatchRecord(row: RawDispatchRecordRow): DispatchRecordT {
  return DispatchRecord.parse({
    dispatch_id: row.dispatch_id,
    turn_id: row.turn_id,
    turn_item_id: row.turn_item_id,
    workflow_run_step_id: row.workflow_run_step_id,
    requested_node_id: row.requested_node_id,
    selected_node_id: row.selected_node_id,
    capability: row.capability,
    action: parseJson(row.action_json),
    task_id: row.task_id,
    status: row.status,
    result: parseJson(row.result_json),
    evidence: parseJson(row.evidence_json),
    error: row.error,
    policy_snapshot_id: row.policy_snapshot_id,
    connection_id: row.connection_id,
    edge_id: row.edge_id,
    created_at: normalizeDateTime(row.created_at),
    updated_at: normalizeDateTime(row.updated_at),
    completed_at: normalizeDateTime(row.completed_at),
  });
}

export class DispatchRecordDal {
  constructor(private readonly db: SqlDb) {}

  async create(input: {
    tenantId: string;
    dispatchId: string;
    capability: string;
    action: ActionPrimitive;
    taskId: string;
    status?: DispatchRecordT["status"];
    turnId?: string | null;
    turnItemId?: string | null;
    workflowRunStepId?: string | null;
    requestedNodeId?: string | null;
    selectedNodeId?: string | null;
    policySnapshotId?: string | null;
    connectionId?: string | null;
    edgeId?: string | null;
    createdAtIso?: string;
  }): Promise<DispatchRecordT> {
    const createdAtIso = input.createdAtIso ?? new Date().toISOString();
    const row = await this.db.get<RawDispatchRecordRow>(
      `INSERT INTO dispatch_records (
         tenant_id,
         dispatch_id,
         turn_id,
         turn_item_id,
         workflow_run_step_id,
         requested_node_id,
         selected_node_id,
         capability,
         action_json,
         task_id,
         status,
         result_json,
         evidence_json,
         error,
         policy_snapshot_id,
         connection_id,
         edge_id,
         created_at,
         updated_at,
         completed_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING
         dispatch_id,
         turn_id,
         turn_item_id,
         workflow_run_step_id,
         requested_node_id,
         selected_node_id,
         capability,
         action_json,
         task_id,
         status,
         result_json,
         evidence_json,
         error,
         policy_snapshot_id,
         connection_id,
         edge_id,
         created_at,
         updated_at,
         completed_at`,
      [
        input.tenantId,
        input.dispatchId,
        input.turnId ?? null,
        input.turnItemId ?? null,
        input.workflowRunStepId ?? null,
        input.requestedNodeId ?? null,
        input.selectedNodeId ?? null,
        input.capability,
        JSON.stringify(input.action),
        input.taskId,
        input.status ?? "dispatched",
        null,
        null,
        null,
        input.policySnapshotId ?? null,
        input.connectionId ?? null,
        input.edgeId ?? null,
        createdAtIso,
        createdAtIso,
        null,
      ],
    );
    if (!row) {
      throw new Error(`dispatch record '${input.dispatchId}' was not inserted`);
    }
    return toDispatchRecord(row);
  }

  async getByDispatchId(input: {
    tenantId: string;
    dispatchId: string;
  }): Promise<DispatchRecordT | undefined> {
    const row = await this.db.get<RawDispatchRecordRow>(
      `SELECT
         dispatch_id,
         turn_id,
         turn_item_id,
         workflow_run_step_id,
         requested_node_id,
         selected_node_id,
         capability,
         action_json,
         task_id,
         status,
         result_json,
         evidence_json,
         error,
         policy_snapshot_id,
         connection_id,
         edge_id,
         created_at,
         updated_at,
         completed_at
       FROM dispatch_records
       WHERE tenant_id = ? AND dispatch_id = ?`,
      [input.tenantId, input.dispatchId],
    );
    return row ? toDispatchRecord(row) : undefined;
  }

  async updateEvidence(input: {
    tenantId: string;
    dispatchId: string;
    evidence: unknown;
    updatedAtIso?: string;
  }): Promise<void> {
    await this.db.run(
      `UPDATE dispatch_records
       SET evidence_json = ?,
           updated_at = ?
       WHERE tenant_id = ? AND dispatch_id = ?`,
      [
        JSON.stringify(input.evidence),
        input.updatedAtIso ?? new Date().toISOString(),
        input.tenantId,
        input.dispatchId,
      ],
    );
  }

  async completeByTaskId(input: {
    tenantId: string;
    taskId: string;
    ok: boolean;
    result?: unknown;
    evidence?: unknown;
    error?: string;
    completedAtIso?: string;
  }): Promise<void> {
    const completedAtIso = input.completedAtIso ?? new Date().toISOString();
    await this.db.run(
      `UPDATE dispatch_records
       SET status = ?,
           result_json = ?,
           evidence_json = ?,
           error = ?,
           updated_at = ?,
           completed_at = ?
       WHERE tenant_id = ? AND task_id = ?`,
      [
        input.ok ? "succeeded" : "failed",
        input.result === undefined ? null : JSON.stringify(input.result),
        input.evidence === undefined ? null : JSON.stringify(input.evidence),
        input.error ?? null,
        completedAtIso,
        completedAtIso,
        input.tenantId,
        input.taskId,
      ],
    );
  }
}

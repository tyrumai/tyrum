import {
  WorkflowRun,
  WorkflowRunStep,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
  WorkflowRunTrigger,
  type WorkflowRun as WorkflowRunT,
  type WorkflowRunStep as WorkflowRunStepT,
} from "@tyrum/contracts";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";

export interface RawWorkflowRunRow {
  workflow_run_id: string;
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  run_key: string;
  conversation_key: string | null;
  status: string;
  trigger_json: string;
  plan_id: string | null;
  request_id: string | null;
  input_json: string | null;
  budgets_json: string | null;
  policy_snapshot_id: string | null;
  attempt: number;
  current_step_index: number | null;
  created_at: string | Date;
  updated_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  blocked_reason: string | null;
  blocked_detail: string | null;
  budget_overridden_at: string | Date | null;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  checkpoint_json: string | null;
  last_progress_at: string | Date | null;
  last_progress_json: string | null;
}

export interface RawWorkflowRunStepRow {
  tenant_id: string;
  workflow_run_step_id: string;
  workflow_run_id: string;
  step_index: number;
  status: string;
  action_json: string;
  created_at: string | Date;
  updated_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  idempotency_key: string | null;
  postcondition_json: string | null;
  result_json: string | null;
  error: string | null;
  artifacts_json: string;
  metadata_json: string | null;
  cost_json: string | null;
  policy_snapshot_id: string | null;
  policy_decision_json: string | null;
  policy_applied_override_ids_json: string | null;
  attempt_count: number;
  max_attempts: number;
  timeout_ms: number;
}

function parseOptionalJson(raw: string | null): unknown | null {
  return raw === null ? null : safeJsonParse(raw, null as unknown);
}

function parseOptionalArray(raw: string | null): unknown[] | null {
  return raw === null ? null : safeJsonParse(raw, [] as unknown[]);
}

function normalizeWorkflowRunStatus(status: string): WorkflowRunT["status"] {
  const parsed = WorkflowRunStatus.safeParse(status);
  return parsed.success ? parsed.data : "queued";
}

function normalizeWorkflowRunStepStatus(status: string): WorkflowRunStepT["status"] {
  const parsed = WorkflowRunStepStatus.safeParse(status);
  return parsed.success ? parsed.data : "queued";
}

export function toWorkflowRun(row: RawWorkflowRunRow): WorkflowRunT {
  const trigger = WorkflowRunTrigger.parse(safeJsonParse(row.trigger_json, {}));

  return WorkflowRun.parse({
    workflow_run_id: row.workflow_run_id,
    tenant_id: row.tenant_id,
    agent_id: row.agent_id,
    workspace_id: row.workspace_id,
    run_key: row.run_key,
    conversation_key: row.conversation_key,
    status: normalizeWorkflowRunStatus(row.status),
    trigger,
    plan_id: row.plan_id,
    request_id: row.request_id,
    input: parseOptionalJson(row.input_json),
    budgets: parseOptionalJson(row.budgets_json),
    policy_snapshot_id: row.policy_snapshot_id,
    attempt: row.attempt,
    current_step_index: row.current_step_index,
    created_at: normalizeDbDateTime(row.created_at),
    updated_at: normalizeDbDateTime(row.updated_at),
    started_at: normalizeDbDateTime(row.started_at),
    finished_at: normalizeDbDateTime(row.finished_at),
    blocked_reason: row.blocked_reason,
    blocked_detail: row.blocked_detail,
    budget_overridden_at: normalizeDbDateTime(row.budget_overridden_at),
    lease_owner: row.lease_owner,
    lease_expires_at_ms: row.lease_expires_at_ms,
    checkpoint: parseOptionalJson(row.checkpoint_json),
    last_progress_at: normalizeDbDateTime(row.last_progress_at),
    last_progress: parseOptionalJson(row.last_progress_json),
  });
}

export function toWorkflowRunStep(row: RawWorkflowRunStepRow): WorkflowRunStepT {
  return WorkflowRunStep.parse({
    tenant_id: row.tenant_id,
    workflow_run_step_id: row.workflow_run_step_id,
    workflow_run_id: row.workflow_run_id,
    step_index: row.step_index,
    status: normalizeWorkflowRunStepStatus(row.status),
    action: safeJsonParse(row.action_json, {}),
    created_at: normalizeDbDateTime(row.created_at),
    updated_at: normalizeDbDateTime(row.updated_at),
    started_at: normalizeDbDateTime(row.started_at),
    finished_at: normalizeDbDateTime(row.finished_at),
    idempotency_key: row.idempotency_key,
    postcondition: parseOptionalJson(row.postcondition_json),
    result: parseOptionalJson(row.result_json),
    error: row.error,
    artifacts: safeJsonParse(row.artifacts_json, [] as unknown[]),
    metadata: parseOptionalJson(row.metadata_json),
    cost: parseOptionalJson(row.cost_json),
    policy_snapshot_id: row.policy_snapshot_id,
    policy_decision: parseOptionalJson(row.policy_decision_json),
    policy_applied_override_ids: parseOptionalArray(row.policy_applied_override_ids_json),
    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
    timeout_ms: row.timeout_ms,
  });
}

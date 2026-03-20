import { WorkItemFingerprint } from "@tyrum/contracts";
import type {
  AgentStateKVEntry,
  ArtifactRef,
  DecisionRecord,
  ExecutionBudgets,
  WorkArtifact,
  WorkArtifactKind,
  WorkItem,
  WorkItemKind,
  WorkItemState,
  WorkItemStateKVEntry,
  WorkItemTask,
  WorkItemTaskState,
  WorkSignal,
  WorkSignalStatus,
  WorkSignalTriggerKind,
} from "@tyrum/contracts";
import type { WsBroadcastAudience } from "../../ws/audience.js";
export {
  type RawSubagentRow,
  type RawWorkClarificationRow,
  toSubagent,
  toWorkClarification,
} from "./dal-helpers-agent.js";

type RawTime = string | Date;

export const DEFAULT_WORK_ITEM_WIP_LIMIT = 2;

export const WORKBOARD_WS_AUDIENCE = {
  roles: ["client"],
  required_scopes: ["operator.read", "operator.write"],
} as const satisfies WsBroadcastAudience;

export const WORK_ITEM_TRANSITIONS: Record<WorkItemState, WorkItemState[]> = {
  backlog: ["ready"],
  ready: ["doing", "cancelled"],
  doing: ["ready", "blocked", "done", "failed", "cancelled"],
  blocked: ["ready", "doing", "cancelled"],
  done: [],
  failed: [],
  cancelled: [],
};

type WorkboardTransitionErrorCode =
  | "invalid_transition"
  | "wip_limit_exceeded"
  | "readiness_gate_failed";

export interface WorkboardTransitionErrorDetails {
  code: WorkboardTransitionErrorCode;
  from: WorkItemState;
  to: WorkItemState;
  allowed?: WorkItemState[];
  limit?: number;
  current?: number;
  reasons?: string[];
}

export class WorkboardTransitionError extends Error {
  constructor(
    public readonly code: WorkboardTransitionErrorCode,
    public readonly details: WorkboardTransitionErrorDetails,
    message: string,
  ) {
    super(message);
    this.name = "WorkboardTransitionError";
  }
}

export function isTerminalWorkItemState(status: WorkItemState): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

export function hashScopeLockSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

export function normalizeCount(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function normalizeTime(value: RawTime): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeMaybeTime(value: RawTime | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function parseJsonOr(raw: string | null, fallback: unknown): unknown {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Intentional: treat invalid JSON columns as the provided fallback.
    return fallback;
  }
}

function parseJsonMaybe(raw: string | null): unknown | undefined {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Intentional: treat invalid JSON columns as missing.
    return undefined;
  }
}

export { escapeLikePattern } from "../../utils/sql-like.js";

type Cursor = { sort: string; id: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

export function decodeCursor(raw: string): Cursor {
  try {
    const json = Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "sort" in parsed &&
      "id" in parsed &&
      typeof (parsed as { sort: unknown }).sort === "string" &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return { sort: (parsed as { sort: string }).sort, id: (parsed as { id: string }).id };
    }
  } catch {
    // Intentional: fall through to a generic cursor error for malformed/unknown cursors.
  }
  throw new Error("invalid cursor");
}

export interface RawWorkItemRow {
  work_item_id: string;
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  kind: string;
  title: string;
  status: string;
  priority: number;
  acceptance_json: string | null;
  fingerprint_json: string | null;
  budgets_json: string | null;
  created_from_session_key: string;
  created_at: RawTime;
  updated_at: RawTime;
  last_active_at: RawTime | null;
  parent_work_item_id: string | null;
}

export function toWorkItem(raw: RawWorkItemRow): WorkItem {
  const budgets =
    raw.budgets_json === null ? null : (parseJsonOr(raw.budgets_json, null) as ExecutionBudgets);
  const fingerprintRaw = parseJsonMaybe(raw.fingerprint_json);
  const fingerprint =
    fingerprintRaw === undefined
      ? undefined
      : (() => {
          const parsed = WorkItemFingerprint.safeParse(fingerprintRaw);
          return parsed.success ? parsed.data : undefined;
        })();
  return {
    work_item_id: raw.work_item_id,
    tenant_id: raw.tenant_id,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    kind: raw.kind as WorkItemKind,
    title: raw.title,
    status: raw.status as WorkItemState,
    priority: raw.priority,
    created_at: normalizeTime(raw.created_at),
    created_from_session_key: raw.created_from_session_key,
    last_active_at: normalizeMaybeTime(raw.last_active_at),
    acceptance: parseJsonMaybe(raw.acceptance_json),
    fingerprint,
    budgets,
    parent_work_item_id: raw.parent_work_item_id ?? undefined,
    updated_at: normalizeTime(raw.updated_at),
  };
}

export interface RawKvRow {
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  work_item_id?: string;
  key: string;
  value_json: string;
  updated_at: RawTime;
  updated_by_run_id: string | null;
  provenance_json: string | null;
}

export function toKvEntry(raw: RawKvRow): AgentStateKVEntry | WorkItemStateKVEntry {
  const base = {
    tenant_id: raw.tenant_id,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    key: raw.key,
    value_json: parseJsonOr(raw.value_json, null),
    updated_at: normalizeTime(raw.updated_at),
    updated_by_run_id: raw.updated_by_run_id ?? undefined,
    provenance_json: parseJsonMaybe(raw.provenance_json),
  };
  if (raw.work_item_id) {
    return { ...base, work_item_id: raw.work_item_id };
  }
  return base;
}

export interface RawWorkArtifactRow {
  artifact_id: string;
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  work_item_id: string | null;
  kind: string;
  title: string;
  body_md: string | null;
  refs_json: string;
  confidence: number | null;
  created_at: RawTime;
  created_by_run_id: string | null;
  created_by_subagent_id: string | null;
  provenance_json: string | null;
}

export function toWorkArtifact(raw: RawWorkArtifactRow): WorkArtifact {
  return {
    artifact_id: raw.artifact_id,
    tenant_id: raw.tenant_id,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    work_item_id: raw.work_item_id ?? undefined,
    kind: raw.kind as WorkArtifactKind,
    title: raw.title,
    body_md: raw.body_md ?? undefined,
    refs: parseJsonOr(raw.refs_json, []) as string[],
    confidence: raw.confidence ?? undefined,
    created_at: normalizeTime(raw.created_at),
    created_by_run_id: raw.created_by_run_id ?? undefined,
    created_by_subagent_id: raw.created_by_subagent_id ?? undefined,
    provenance_json: parseJsonMaybe(raw.provenance_json),
  };
}

export interface RawDecisionRow {
  decision_id: string;
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  work_item_id: string | null;
  question: string;
  chosen: string;
  alternatives_json: string;
  rationale_md: string;
  input_artifact_ids_json: string;
  created_at: RawTime;
  created_by_run_id: string | null;
  created_by_subagent_id: string | null;
}

export function toDecisionRecord(raw: RawDecisionRow): DecisionRecord {
  return {
    decision_id: raw.decision_id,
    tenant_id: raw.tenant_id,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    work_item_id: raw.work_item_id ?? undefined,
    question: raw.question,
    chosen: raw.chosen,
    alternatives: parseJsonOr(raw.alternatives_json, []) as string[],
    rationale_md: raw.rationale_md,
    input_artifact_ids: parseJsonOr(raw.input_artifact_ids_json, []) as string[],
    created_at: normalizeTime(raw.created_at),
    created_by_run_id: raw.created_by_run_id ?? undefined,
    created_by_subagent_id: raw.created_by_subagent_id ?? undefined,
  };
}

export interface RawWorkSignalRow {
  signal_id: string;
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  work_item_id: string | null;
  trigger_kind: string;
  trigger_spec_json: string;
  payload_json: string | null;
  status: string;
  created_at: RawTime;
  last_fired_at: RawTime | null;
}

export function toWorkSignal(raw: RawWorkSignalRow): WorkSignal {
  return {
    signal_id: raw.signal_id,
    tenant_id: raw.tenant_id,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    work_item_id: raw.work_item_id ?? undefined,
    trigger_kind: raw.trigger_kind as WorkSignalTriggerKind,
    trigger_spec_json: parseJsonOr(raw.trigger_spec_json, null),
    payload_json: parseJsonMaybe(raw.payload_json),
    status: raw.status as WorkSignalStatus,
    created_at: normalizeTime(raw.created_at),
    last_fired_at: normalizeMaybeTime(raw.last_fired_at) ?? undefined,
  };
}

export interface RawWorkItemTaskRow {
  task_id: string;
  work_item_id: string;
  status: string;
  lease_owner?: string | null;
  lease_expires_at_ms?: number | null;
  depends_on_json: string;
  execution_profile: string;
  side_effect_class: string;
  run_id: string | null;
  approval_id: string | null;
  subagent_id: string | null;
  pause_reason: string | null;
  pause_detail: string | null;
  artifacts_json: string;
  started_at: RawTime | null;
  finished_at: RawTime | null;
  result_summary: string | null;
  created_at: RawTime;
  updated_at: RawTime;
}

export function toWorkItemTask(raw: RawWorkItemTaskRow): WorkItemTask {
  return {
    task_id: raw.task_id,
    work_item_id: raw.work_item_id,
    status: raw.status as WorkItemTaskState,
    depends_on: parseTaskDepsJson(raw.depends_on_json),
    execution_profile: raw.execution_profile,
    side_effect_class: raw.side_effect_class,
    run_id: raw.run_id ?? undefined,
    approval_id: raw.approval_id ?? undefined,
    subagent_id: raw.subagent_id ?? undefined,
    pause_reason: raw.pause_reason ?? undefined,
    pause_detail: raw.pause_detail ?? undefined,
    artifacts: parseJsonOr(raw.artifacts_json, []) as ArtifactRef[],
    started_at: normalizeMaybeTime(raw.started_at),
    finished_at: normalizeMaybeTime(raw.finished_at),
    result_summary: raw.result_summary ?? undefined,
  } as WorkItemTask;
}

export function parseTaskDepsJson(raw: string | null): string[] {
  const parsed = parseJsonOr(raw, []);
  if (!Array.isArray(parsed)) return [];
  const deps: string[] = [];
  for (const value of parsed) {
    if (typeof value !== "string") continue;
    deps.push(value);
  }
  return normalizeTaskDeps(deps);
}

export function normalizeTaskDeps(input: readonly string[] | undefined): string[] {
  if (!input || input.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const id = raw.trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function hasTaskDependencyCycle(adj: Map<string, string[]>): boolean {
  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited,1=visiting,2=done

  const dfs = (node: string): boolean => {
    const s = state.get(node) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(node, 1);
    const deps = adj.get(node) ?? [];
    for (const dep of deps) {
      if (dfs(dep)) return true;
    }
    state.set(node, 2);
    return false;
  };

  for (const node of adj.keys()) {
    if ((state.get(node) ?? 0) !== 0) continue;
    if (dfs(node)) return true;
  }
  return false;
}

export interface RawWorkItemLinkRow {
  work_item_id: string;
  linked_work_item_id: string;
  kind: string;
  meta_json: string;
  created_at: RawTime;
}

export interface WorkItemLinkRow {
  work_item_id: string;
  linked_work_item_id: string;
  kind: string;
  meta_json: unknown;
  created_at: string;
}

export function toWorkItemLink(raw: RawWorkItemLinkRow): WorkItemLinkRow {
  return {
    work_item_id: raw.work_item_id,
    linked_work_item_id: raw.linked_work_item_id,
    kind: raw.kind,
    meta_json: parseJsonOr(raw.meta_json, {}),
    created_at: normalizeTime(raw.created_at),
  };
}

export interface RawScopeActivityRow {
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  last_active_session_key: string;
  updated_at_ms: number;
}

export type WorkScopeActivityRow = RawScopeActivityRow;

export interface RawWorkItemEventRow {
  event_id: string;
  work_item_id: string;
  created_at: RawTime;
  kind: string;
  payload_json: string;
}

export interface WorkItemEventRow {
  event_id: string;
  work_item_id: string;
  created_at: string;
  kind: string;
  payload: unknown;
}

export function toWorkItemEvent(raw: RawWorkItemEventRow): WorkItemEventRow {
  return {
    event_id: raw.event_id,
    work_item_id: raw.work_item_id,
    created_at: normalizeTime(raw.created_at),
    kind: raw.kind,
    payload: parseJsonOr(raw.payload_json, {}),
  };
}

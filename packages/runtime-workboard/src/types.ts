import type {
  AgentStateKVEntry,
  DecisionRecord,
  SubagentDescriptor,
  SubagentStatus,
  WorkClarification,
  WorkArtifact,
  WorkItemLink,
  WorkItem,
  WorkItemState,
  WorkItemTask,
  WorkItemTaskState,
  WorkScope,
  WorkSignal,
  WorkStateKVScopeIds,
  WorkItemStateKVEntry,
} from "@tyrum/contracts";

export interface WorkboardLogger {
  warn(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
}

export type WorkboardItemEventType =
  | "work.item.created"
  | "work.item.updated"
  | "work.item.blocked"
  | "work.item.completed"
  | "work.item.failed"
  | "work.item.cancelled"
  | "work.item.deleted";

export type WorkboardStateScope = WorkScope & {
  kind: "work_item";
  work_item_id: string;
};

export interface WorkboardStateEntry {
  value_json: unknown;
}

export interface WorkboardItemRef {
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  work_item_id: string;
}

export interface WorkboardPlannerSubagentRef {
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  subagent_id: string;
  work_item_id: string;
}

export interface CreateWorkItemInput {
  kind: WorkItem["kind"];
  title: string;
  priority?: number;
  acceptance?: unknown;
  fingerprint?: WorkItem["fingerprint"];
  budgets?: WorkItem["budgets"];
  parent_work_item_id?: string;
  created_from_conversation_key?: string;
}

export interface UpdateWorkItemPatch {
  title?: string;
  priority?: number;
  acceptance?: unknown;
  fingerprint?: WorkItem["fingerprint"];
  budgets?: WorkItem["budgets"] | null;
  last_active_at?: string | null;
}

export interface CreateWorkArtifactInput {
  work_item_id?: string;
  kind: WorkArtifact["kind"];
  title: string;
  body_md?: string;
  refs?: WorkArtifact["refs"];
  created_by_turn_id?: string;
  created_by_subagent_id?: string;
}

export interface CreateWorkDecisionInput {
  work_item_id?: string;
  question: string;
  chosen: string;
  alternatives?: string[];
  rationale_md: string;
  input_artifact_ids?: string[];
  created_by_turn_id?: string;
  created_by_subagent_id?: string;
}

export interface CreateWorkSignalInput {
  work_item_id?: string;
  trigger_kind: WorkSignal["trigger_kind"];
  trigger_spec_json: unknown;
  payload_json?: unknown;
  status?: WorkSignal["status"];
}

export interface UpdateWorkSignalPatch {
  status?: WorkSignal["status"];
  trigger_spec_json?: unknown;
  payload_json?: unknown;
  last_fired_at?: string | null;
}

export interface CreateWorkItemTaskInput {
  work_item_id: string;
  status: WorkItemTaskState;
  execution_profile: string;
  side_effect_class: string;
  result_summary?: string;
}

export interface UpdateWorkItemTaskPatch {
  status?: WorkItemTaskState;
  turn_id?: string | null;
  approval_id?: string | null;
  subagent_id?: string | null;
  pause_reason?: string | null;
  pause_detail?: string | null;
  started_at?: string;
  finished_at?: string;
  result_summary?: string;
}

export interface CreateSubagentInput {
  execution_profile: string;
  conversation_key?: string;
  parent_conversation_key?: string;
  work_item_id?: string;
  work_item_task_id?: string;
  status?: SubagentStatus;
  desktop_environment_id?: string;
  attached_node_id?: string;
}

export interface UpdateSubagentPatch {
  status?: SubagentStatus;
  desktop_environment_id?: string;
  attached_node_id?: string;
}

export interface WorkboardLeasedTask {
  task: WorkItemTask;
}

export interface WorkboardTaskRow {
  task_id: string;
  status: WorkItemTaskState;
  execution_profile: string;
  lease_owner?: string | null;
  approval_id?: string | null;
}

export interface WorkboardCaptureEventInput {
  kind?: string;
  payload_json?: unknown;
}

export interface WorkboardDeleteEffects {
  childItemIds: string[];
  attachedSignalIds: string[];
}

export interface WorkboardRepository {
  listBacklogItems(limit: number): Promise<WorkboardItemRef[]>;
  listReadyItems(limit: number): Promise<WorkboardItemRef[]>;
  listDoingItems(limit: number): Promise<WorkboardItemRef[]>;
  listPlannerSubagentsOutsideBacklog(limit: number): Promise<WorkboardPlannerSubagentRef[]>;
  getItem(params: { scope: WorkScope; work_item_id: string }): Promise<WorkItem | undefined>;
  transitionItem(params: {
    scope: WorkScope;
    work_item_id: string;
    status: WorkItemState;
    reason?: string;
  }): Promise<WorkItem | undefined>;
  listTasks(params: { scope: WorkScope; work_item_id: string }): Promise<WorkItemTask[]>;
  createTask(params: { scope: WorkScope; task: CreateWorkItemTaskInput }): Promise<WorkItemTask>;
  updateTask(params: {
    scope: WorkScope;
    task_id: string;
    lease_owner?: string;
    nowMs?: number;
    allowExpiredLeaseRelease?: boolean;
    updatedAtIso?: string;
    patch: UpdateWorkItemTaskPatch;
  }): Promise<WorkItemTask | undefined>;
  leaseRunnableTasks(params: {
    scope: WorkScope;
    work_item_id: string;
    lease_owner: string;
    limit: number;
  }): Promise<{ leased: WorkboardLeasedTask[] }>;
  getStateKv(params: {
    scope: WorkboardStateScope;
    key: string;
  }): Promise<WorkboardStateEntry | undefined>;
  setStateKv(params: {
    scope: WorkboardStateScope;
    key: string;
    value_json: unknown;
    provenance_json: unknown;
    updatedByTurnId?: string;
  }): Promise<unknown>;
  requeueOrphanedTasks(params: {
    scope: WorkScope;
    work_item_id: string;
    updated_at: string;
  }): Promise<void>;
  listClarifications(params: {
    scope: WorkScope;
    work_item_id: string;
    statuses: WorkClarification["status"][];
    limit: number;
  }): Promise<{ clarifications: WorkClarification[] }>;
  createSubagent(params: {
    scope: WorkScope;
    subagentId?: string;
    subagent: CreateSubagentInput;
  }): Promise<SubagentDescriptor>;
  listSubagents(params: {
    scope: WorkScope;
    parent_conversation_key?: string;
    work_item_id?: string;
    work_item_task_id?: string;
    execution_profile?: string;
    statuses?: SubagentStatus[];
    limit?: number;
    cursor?: string;
  }): Promise<{ subagents: SubagentDescriptor[]; next_cursor?: string }>;
  getSubagent(params: {
    scope: WorkScope;
    subagent_id: string;
    parent_conversation_key?: string;
  }): Promise<SubagentDescriptor | undefined>;
  closeSubagent(params: {
    scope: WorkScope;
    subagent_id: string;
    parent_conversation_key?: string;
    reason?: string;
    closedAtIso?: string;
  }): Promise<SubagentDescriptor | undefined>;
  markSubagentClosed(params: {
    scope: WorkScope;
    subagent_id: string;
    closedAtIso?: string;
  }): Promise<SubagentDescriptor | undefined>;
  markSubagentFailed(params: {
    scope: WorkScope;
    subagent_id: string;
    reason: string;
  }): Promise<SubagentDescriptor | undefined>;
  updateSubagent(params: {
    scope: WorkScope;
    subagent_id: string;
    patch: UpdateSubagentPatch;
  }): Promise<SubagentDescriptor | undefined>;
}

export interface WorkboardCrudRepository {
  createItem(params: {
    scope: WorkScope;
    item: CreateWorkItemInput;
    createdFromConversationKey?: string;
    captureEvent?: WorkboardCaptureEventInput;
  }): Promise<WorkItem>;
  listItems(params: {
    scope: WorkScope;
    statuses?: WorkItemState[];
    kinds?: WorkItem["kind"][];
    limit?: number;
    cursor?: string;
  }): Promise<{ items: WorkItem[]; next_cursor?: string }>;
  getItem(params: { scope: WorkScope; work_item_id: string }): Promise<WorkItem | undefined>;
  updateItem(params: {
    scope: WorkScope;
    work_item_id: string;
    patch: UpdateWorkItemPatch;
  }): Promise<WorkItem | undefined>;
  deleteItem(params: { scope: WorkScope; work_item_id: string }): Promise<WorkItem | undefined>;
  transitionItem(params: {
    scope: WorkScope;
    work_item_id: string;
    status: WorkItemState;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<WorkItem | undefined>;
  createLink(params: {
    scope: WorkScope;
    work_item_id: string;
    linked_work_item_id: string;
    kind: WorkItemLink["kind"];
    meta_json?: unknown;
  }): Promise<WorkItemLink>;
  listLinks(params: {
    scope: WorkScope;
    work_item_id: string;
    limit?: number;
  }): Promise<{ links: WorkItemLink[] }>;
  listArtifacts(params: {
    scope: WorkScope;
    work_item_id?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ artifacts: WorkArtifact[]; next_cursor?: string }>;
  getArtifact(params: { scope: WorkScope; artifact_id: string }): Promise<WorkArtifact | undefined>;
  createArtifact(params: {
    scope: WorkScope;
    artifact: CreateWorkArtifactInput;
  }): Promise<WorkArtifact>;
  listDecisions(params: {
    scope: WorkScope;
    work_item_id?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ decisions: DecisionRecord[]; next_cursor?: string }>;
  getDecision(params: {
    scope: WorkScope;
    decision_id: string;
  }): Promise<DecisionRecord | undefined>;
  createDecision(params: {
    scope: WorkScope;
    decision: CreateWorkDecisionInput;
  }): Promise<DecisionRecord>;
  listSignals(params: {
    scope: WorkScope;
    work_item_id?: string;
    statuses?: WorkSignal["status"][];
    limit?: number;
    cursor?: string;
  }): Promise<{ signals: WorkSignal[]; next_cursor?: string }>;
  getSignal(params: { scope: WorkScope; signal_id: string }): Promise<WorkSignal | undefined>;
  createSignal(params: { scope: WorkScope; signal: CreateWorkSignalInput }): Promise<WorkSignal>;
  updateSignal(params: {
    scope: WorkScope;
    signal_id: string;
    patch: UpdateWorkSignalPatch;
  }): Promise<{ signal: WorkSignal; changed: boolean } | undefined>;
  getStateKv(params: {
    scope: WorkStateKVScopeIds;
    key: string;
  }): Promise<AgentStateKVEntry | WorkItemStateKVEntry | undefined>;
  listStateKv(params: {
    scope: WorkStateKVScopeIds;
    prefix?: string;
  }): Promise<{ entries: Array<AgentStateKVEntry | WorkItemStateKVEntry> }>;
  setStateKv(params: {
    scope: WorkStateKVScopeIds;
    key: string;
    value_json: unknown;
    provenance_json?: unknown;
    updatedByTurnId?: string;
  }): Promise<AgentStateKVEntry | WorkItemStateKVEntry>;
}

export type WorkboardServiceRepository = WorkboardCrudRepository &
  Pick<
    WorkboardRepository,
    | "createTask"
    | "updateTask"
    | "listSubagents"
    | "updateSubagent"
    | "closeSubagent"
    | "markSubagentClosed"
  > & {
    listTaskRows(params: { scope: WorkScope; work_item_id: string }): Promise<WorkboardTaskRow[]>;
  };

export interface WorkboardServiceEffects {
  emitItemEvent?(params: { type: WorkboardItemEventType; item: WorkItem }): Promise<void>;
  notifyItemTransition?(params: { scope: WorkScope; item: WorkItem }): Promise<void>;
  interruptSubagents?(params: {
    subagents: SubagentDescriptor[];
    detail: string;
    createdAtMs?: number;
  }): Promise<void>;
  clearSubagentSignals?(params: { subagents: SubagentDescriptor[] }): Promise<void>;
  resolvePendingInterventionApprovals?(params: {
    scope: WorkScope;
    work_item_id: string;
    decision: "approved" | "denied";
    reason: string;
  }): Promise<void>;
  loadDeleteEffects?(params: {
    scope: WorkScope;
    work_item_id: string;
  }): Promise<WorkboardDeleteEffects>;
  emitDeleteEffects?(params: {
    scope: WorkScope;
    childItemIds: string[];
    attachedSignalIds: string[];
  }): Promise<void>;
}

export type SubagentRepository = Pick<
  WorkboardRepository,
  | "createSubagent"
  | "listSubagents"
  | "getSubagent"
  | "closeSubagent"
  | "markSubagentClosed"
  | "markSubagentFailed"
  | "updateSubagent"
>;

export type WorkboardOrchestratorRepository = Pick<
  WorkboardRepository,
  | "listBacklogItems"
  | "listPlannerSubagentsOutsideBacklog"
  | "listClarifications"
  | "getItem"
  | "listTasks"
  | "createTask"
  | "updateTask"
  | "leaseRunnableTasks"
  | "setStateKv"
  | "listSubagents"
  | "markSubagentClosed"
> &
  SubagentRepository;

export type WorkboardDispatcherRepository = Pick<
  WorkboardRepository,
  | "listReadyItems"
  | "listDoingItems"
  | "getItem"
  | "listTasks"
  | "createTask"
  | "updateTask"
  | "leaseRunnableTasks"
  | "transitionItem"
  | "getStateKv"
  | "setStateKv"
  | "markSubagentClosed"
  | "markSubagentFailed"
> &
  SubagentRepository & {
    acquireExecutionSlot(params: {
      scope: WorkScope;
      task_id: string;
      owner: string;
      limit: number;
      nowMs?: number;
      ttlMs?: number;
    }): Promise<boolean>;
    releaseExecutionSlot(params: { scope: WorkScope; task_id: string }): Promise<void>;
  };

export type WorkboardReconcilerRepository = Pick<
  WorkboardRepository,
  | "listDoingItems"
  | "listSubagents"
  | "listTasks"
  | "transitionItem"
  | "getStateKv"
  | "setStateKv"
  | "requeueOrphanedTasks"
  | "getItem"
  | "updateTask"
> & {
  createInterventionApproval(params: {
    scope: WorkScope;
    work_item_id: string;
    task_id: string;
    reason: string;
  }): Promise<{ approval_id: string } | undefined>;
};

export type WorkboardSubagentTurnTarget = Pick<
  SubagentDescriptor,
  | "subagent_id"
  | "conversation_key"
  | "agent_id"
  | "work_item_id"
  | "work_item_task_id"
  | "attached_node_id"
>;

export interface WorkboardConversationKeyBuilder {
  buildConversationKey(scope: WorkScope, subagentId: string): Promise<string>;
}

export interface WorkboardSubagentTurnResult {
  reply: string;
  conversation_key: string;
  turn_id?: string;
}

export interface WorkboardSubagentRuntime extends WorkboardConversationKeyBuilder {
  runTurn(input: {
    scope: WorkScope;
    subagent: WorkboardSubagentTurnTarget;
    message: string;
  }): Promise<WorkboardSubagentTurnResult>;
}

export interface ManagedDesktopAttachment {
  desktopEnvironmentId: string;
  attachedNodeId?: string;
}

export interface ManagedDesktopProvisioner {
  provisionManagedDesktop(input: {
    tenantId: string;
    subagentConversationKey: string;
    label: string;
  }): Promise<ManagedDesktopAttachment | undefined>;
}

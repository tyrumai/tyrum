import type {
  AgentStateKVEntry,
  DecisionRecord,
  WorkArtifact,
  Lane,
  SubagentDescriptor,
  SubagentStatus,
  WorkClarification,
  WorkItemLink,
  WorkItem,
  WorkItemState,
  WorkItemTask,
  WorkItemTaskState,
  WorkScope,
  WorkSignal,
  WorkStateKVScopeIds,
  WorkItemStateKVEntry,
  WsWorkArtifactCreateInput,
  WsWorkCreateItemInput,
  WsWorkDecisionCreateInput,
  WsWorkSignalCreateInput,
  WsWorkSignalUpdatePatch,
  WsWorkUpdatePatch,
} from "@tyrum/contracts";

export interface WorkboardLogger {
  warn(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
}

export type WorkboardStateScope = WorkScope & {
  kind: "work_item";
  work_item_id: string;
};

export interface WorkboardStateEntry {
  value_json: unknown;
}

export interface WorkboardItemRef extends WorkScope {
  work_item_id: string;
}

export interface WorkboardPlannerSubagentRef extends WorkScope {
  subagent_id: string;
  work_item_id: string;
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
  started_at?: string;
  finished_at?: string;
  result_summary?: string;
}

export interface CreateSubagentInput {
  execution_profile: string;
  session_key?: string;
  parent_session_key?: string;
  work_item_id?: string;
  work_item_task_id?: string;
  lane?: Lane;
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
    parent_session_key?: string;
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
    parent_session_key?: string;
  }): Promise<SubagentDescriptor | undefined>;
  closeSubagent(params: {
    scope: WorkScope;
    subagent_id: string;
    parent_session_key?: string;
    reason?: string;
  }): Promise<SubagentDescriptor | undefined>;
  markSubagentClosed(params: {
    scope: WorkScope;
    subagent_id: string;
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
    item: WsWorkCreateItemInput;
    createdFromSessionKey?: string;
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
    patch: WsWorkUpdatePatch;
  }): Promise<WorkItem | undefined>;
  transitionItem(params: {
    scope: WorkScope;
    work_item_id: string;
    status: WorkItemState;
    reason?: string;
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
    artifact: WsWorkArtifactCreateInput;
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
    decision: WsWorkDecisionCreateInput;
  }): Promise<DecisionRecord>;
  listSignals(params: {
    scope: WorkScope;
    work_item_id?: string;
    statuses?: WorkSignal["status"][];
    limit?: number;
    cursor?: string;
  }): Promise<{ signals: WorkSignal[]; next_cursor?: string }>;
  getSignal(params: { scope: WorkScope; signal_id: string }): Promise<WorkSignal | undefined>;
  createSignal(params: { scope: WorkScope; signal: WsWorkSignalCreateInput }): Promise<WorkSignal>;
  updateSignal(params: {
    scope: WorkScope;
    signal_id: string;
    patch: WsWorkSignalUpdatePatch;
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
  }): Promise<AgentStateKVEntry | WorkItemStateKVEntry>;
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
  | "listSubagents"
  | "markSubagentClosed"
> &
  SubagentRepository;

export type WorkboardDispatcherRepository = Pick<
  WorkboardRepository,
  | "listReadyItems"
  | "getItem"
  | "listTasks"
  | "createTask"
  | "updateTask"
  | "leaseRunnableTasks"
  | "transitionItem"
  | "getStateKv"
  | "markSubagentClosed"
  | "markSubagentFailed"
> &
  SubagentRepository;

export type WorkboardReconcilerRepository = Pick<
  WorkboardRepository,
  | "listDoingItems"
  | "listSubagents"
  | "listTasks"
  | "transitionItem"
  | "setStateKv"
  | "requeueOrphanedTasks"
  | "getItem"
>;

export type WorkboardSubagentTurnTarget = Pick<
  SubagentDescriptor,
  | "subagent_id"
  | "session_key"
  | "lane"
  | "agent_id"
  | "work_item_id"
  | "work_item_task_id"
  | "attached_node_id"
>;

export interface WorkboardSessionKeyBuilder {
  buildSessionKey(scope: WorkScope, subagentId: string): Promise<string>;
}

export interface WorkboardSubagentRuntime extends WorkboardSessionKeyBuilder {
  runTurn(input: {
    scope: WorkScope;
    subagent: WorkboardSubagentTurnTarget;
    message: string;
  }): Promise<string>;
}

export interface ManagedDesktopAttachment {
  desktopEnvironmentId: string;
  attachedNodeId?: string;
}

export interface ManagedDesktopProvisioner {
  provisionManagedDesktop(input: {
    tenantId: string;
    subagentSessionKey: string;
    subagentLane: Lane;
    label: string;
  }): Promise<ManagedDesktopAttachment | undefined>;
}

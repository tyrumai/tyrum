import type {
  Lane,
  SubagentDescriptor,
  SubagentStatus,
  WorkClarification,
  WorkItem,
  WorkItemState,
  WorkItemTask,
  WorkItemTaskState,
  WorkScope,
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

export interface WorkboardSubagentRuntime {
  buildSessionKey(scope: WorkScope, subagentId: string): Promise<string>;
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

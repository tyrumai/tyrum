import type {
  AgentStateKVEntry,
  DecisionRecord,
  WorkArtifact,
  WorkItem,
  WorkItemStateKVEntry,
  WorkSignal,
} from "@tyrum/schemas";

export const WORK_ITEM_STATUSES = [
  "backlog",
  "ready",
  "doing",
  "blocked",
  "done",
  "failed",
  "cancelled",
] as const;

export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export type WorkItemsByStatus = Record<WorkItemStatus, WorkItem[]>;

export function upsertWorkItem(items: WorkItem[], next: WorkItem): WorkItem[] {
  const existingIndex = items.findIndex((item) => item.work_item_id === next.work_item_id);
  if (existingIndex === -1) {
    return [next, ...items];
  }

  const updated = items.slice();
  updated[existingIndex] = next;
  return updated;
}

export function groupWorkItemsByStatus(items: WorkItem[]): WorkItemsByStatus {
  const grouped = Object.fromEntries(
    WORK_ITEM_STATUSES.map((status) => [status, [] as WorkItem[]]),
  ) as WorkItemsByStatus;

  for (const item of items) {
    const status = item.status as WorkItemStatus;
    if (status in grouped) {
      grouped[status].push(item);
    }
  }

  return grouped;
}

function upsertByStringKey<T>(items: T[], next: T, key: (item: T) => string): T[] {
  const nextKey = key(next);
  const existingIndex = items.findIndex((item) => key(item) === nextKey);
  if (existingIndex === -1) {
    return [next, ...items];
  }

  const updated = items.slice();
  updated[existingIndex] = next;
  return updated;
}

export function upsertWorkArtifact(artifacts: WorkArtifact[], next: WorkArtifact): WorkArtifact[] {
  return upsertByStringKey(artifacts, next, (artifact) => artifact.artifact_id);
}

export function upsertWorkDecision(
  decisions: DecisionRecord[],
  next: DecisionRecord,
): DecisionRecord[] {
  return upsertByStringKey(decisions, next, (decision) => decision.decision_id);
}

export function upsertWorkSignal(signals: WorkSignal[], next: WorkSignal): WorkSignal[] {
  return upsertByStringKey(signals, next, (signal) => signal.signal_id);
}

export type WorkStateKvEntry = AgentStateKVEntry | WorkItemStateKVEntry;

export function upsertWorkStateKvEntry(
  entries: WorkStateKvEntry[],
  next: WorkStateKvEntry,
): WorkStateKvEntry[] {
  return upsertByStringKey(entries, next, (entry) => entry.key);
}

export type WorkTaskStatus = "leased" | "running" | "paused" | "completed";

export type WorkTaskSummary = {
  task_id: string;
  status: WorkTaskStatus;
  last_event_at: string;
  lease_expires_at_ms?: number;
  run_id?: string;
  approval_id?: number;
  result_summary?: string;
};

export type WorkTasksByWorkItemId = Record<string, Record<string, WorkTaskSummary>>;

type BaseWorkTaskEvent = {
  occurred_at: string;
  payload: Record<string, unknown> & {
    work_item_id: string;
    task_id: string;
  };
};

export type WorkTaskEvent =
  | (BaseWorkTaskEvent & {
      type: "work.task.leased";
      payload: BaseWorkTaskEvent["payload"] & { lease_expires_at_ms: number };
    })
  | (BaseWorkTaskEvent & {
      type: "work.task.started";
      payload: BaseWorkTaskEvent["payload"] & { run_id: string };
    })
  | (BaseWorkTaskEvent & {
      type: "work.task.paused";
      payload: BaseWorkTaskEvent["payload"] & { approval_id: number };
    })
  | (BaseWorkTaskEvent & {
      type: "work.task.completed";
      payload: BaseWorkTaskEvent["payload"] & { result_summary?: string };
    });

export function applyWorkTaskEvent(
  tasksByWorkItemId: WorkTasksByWorkItemId,
  event: WorkTaskEvent,
): WorkTasksByWorkItemId {
  const workItemId = event.payload.work_item_id;
  const taskId = event.payload.task_id;

  const prevWorkItemTasks = tasksByWorkItemId[workItemId] ?? {};
  const prevTask = prevWorkItemTasks[taskId];

  const base: WorkTaskSummary = prevTask
    ? { ...prevTask, last_event_at: event.occurred_at }
    : { task_id: taskId, status: "leased", last_event_at: event.occurred_at };

  let next: WorkTaskSummary;
  switch (event.type) {
    case "work.task.leased":
      next = {
        ...base,
        status: "leased",
        lease_expires_at_ms: event.payload.lease_expires_at_ms,
      };
      break;
    case "work.task.started":
      next = { ...base, status: "running", run_id: event.payload.run_id };
      break;
    case "work.task.paused":
      next = { ...base, status: "paused", approval_id: event.payload.approval_id };
      break;
    case "work.task.completed":
      next = { ...base, status: "completed", result_summary: event.payload.result_summary };
      break;
    default:
      return tasksByWorkItemId;
  }

  return {
    ...tasksByWorkItemId,
    [workItemId]: {
      ...prevWorkItemTasks,
      [taskId]: next,
    },
  };
}

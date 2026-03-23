import type { WorkItemState } from "@tyrum/contracts";

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

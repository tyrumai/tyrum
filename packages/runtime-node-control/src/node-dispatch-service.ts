import type { ActionPrimitive } from "@tyrum/contracts";

export type NodeDispatchTaskResult = {
  ok: boolean;
  result?: unknown;
  evidence?: unknown;
  error?: string;
};

export interface NodeDispatchTaskResultPort {
  wait(taskId: string, opts?: { timeoutMs?: number }): Promise<NodeDispatchTaskResult>;
}

export interface NodeDispatchServiceDeps {
  dispatchTask: (
    action: ActionPrimitive,
    scope: {
      tenantId?: string;
      turnId?: string | null;
      turnItemId?: string | null;
      workflowRunStepId?: string | null;
      policySnapshotId?: string | null;
    },
    nodeId?: string,
  ) => Promise<{ taskId: string; dispatchId: string }>;
  taskResults?: NodeDispatchTaskResultPort;
}

export class NodeDispatchService {
  constructor(private readonly deps: NodeDispatchServiceDeps) {}

  async dispatchAndWait(
    action: ActionPrimitive,
    scope: {
      tenantId?: string;
      turnId?: string | null;
      turnItemId?: string | null;
      workflowRunStepId?: string | null;
      policySnapshotId?: string | null;
    },
    opts?: { timeoutMs?: number; nodeId?: string },
  ): Promise<{ taskId: string; dispatchId: string; result: NodeDispatchTaskResult }> {
    const registry = this.deps.taskResults;
    if (!registry) {
      throw new Error("task result registry is not configured");
    }

    const dispatched = await this.deps.dispatchTask(action, scope, opts?.nodeId);
    const result = await registry.wait(dispatched.taskId, { timeoutMs: opts?.timeoutMs });
    return { ...dispatched, result };
  }
}

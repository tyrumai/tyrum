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
    scope: { tenantId?: string; runId: string; stepId: string; attemptId: string },
    nodeId?: string,
  ) => Promise<string>;
  taskResults?: NodeDispatchTaskResultPort;
}

export class NodeDispatchService {
  constructor(private readonly deps: NodeDispatchServiceDeps) {}

  async dispatchAndWait(
    action: ActionPrimitive,
    scope: { tenantId?: string; runId: string; stepId: string; attemptId: string },
    opts?: { timeoutMs?: number; nodeId?: string },
  ): Promise<{ taskId: string; result: NodeDispatchTaskResult }> {
    const registry = this.deps.taskResults;
    if (!registry) {
      throw new Error("task result registry is not configured");
    }

    const taskId = await this.deps.dispatchTask(action, scope, opts?.nodeId);
    const result = await registry.wait(taskId, { timeoutMs: opts?.timeoutMs });
    return { taskId, result };
  }
}

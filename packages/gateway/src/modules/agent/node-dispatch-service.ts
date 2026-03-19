import type { ActionPrimitive } from "@tyrum/contracts";
import { dispatchTask } from "../../ws/protocol.js";
import type { ProtocolDeps } from "../../ws/protocol.js";
import type { TaskResult } from "../../ws/protocol/task-result-registry.js";

export class NodeDispatchService {
  constructor(private readonly deps: ProtocolDeps) {}

  async dispatchAndWait(
    action: ActionPrimitive,
    scope: { tenantId: string; runId: string; stepId: string; attemptId: string },
    opts?: { timeoutMs?: number; nodeId?: string },
  ): Promise<{ taskId: string; result: TaskResult }> {
    const registry = this.deps.taskResults;
    if (!registry) {
      throw new Error("task result registry is not configured");
    }

    const taskId = await dispatchTask(action, scope, this.deps, opts?.nodeId);
    const result = await registry.wait(taskId, { timeoutMs: opts?.timeoutMs });
    return { taskId, result };
  }
}

import type { SubagentDescriptor, WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type { WorkboardDal } from "./dal.js";
import { type WorkTaskRow, interruptSubagents, loadTaskRows } from "./service-support.js";

export async function teardownActiveExecution(params: {
  db: SqlDb;
  scope: WorkScope;
  workItemId: string;
  reason: string;
  workboard: WorkboardDal;
  occurredAtIso?: string;
}): Promise<{
  activeSubagents: SubagentDescriptor[];
  activeTasks: WorkTaskRow[];
}> {
  const occurredAtIso = params.occurredAtIso ?? new Date().toISOString();
  const parsedOccurredAtMs = Date.parse(occurredAtIso);
  const occurredAtMs = Number.isFinite(parsedOccurredAtMs) ? parsedOccurredAtMs : Date.now();
  const [subagents, tasks] = await Promise.all([
    params.workboard.listSubagents({
      scope: params.scope,
      work_item_id: params.workItemId,
      statuses: ["running", "closing"],
      limit: 200,
    }),
    loadTaskRows(params.db, params.scope, params.workItemId),
  ]);

  const activeSubagents = subagents.subagents.filter(
    (subagent) => subagent.status === "running" || subagent.status === "closing",
  );
  const activeTasks = tasks.filter((task) => task.status === "leased" || task.status === "running");

  await interruptSubagents(params.db, activeSubagents, params.reason, occurredAtMs);

  for (const task of activeTasks) {
    if (task.status === "leased" && !task.lease_owner) {
      throw new Error(`leased task ${task.task_id} is missing lease owner`);
    }

    await params.workboard.updateTask({
      scope: params.scope,
      task_id: task.task_id,
      ...(task.status === "leased" ? { lease_owner: task.lease_owner ?? undefined } : {}),
      // Operator cancel/delete must be able to release stale leased rows before reclamation runs.
      ...(task.status === "leased"
        ? {
            nowMs: occurredAtMs,
            allowExpiredLeaseRelease: true,
          }
        : {}),
      patch: {
        status: "cancelled",
        approval_id: null,
        finished_at: occurredAtIso,
        result_summary: params.reason,
      },
      updatedAtIso: occurredAtIso,
    });
  }

  for (const subagent of activeSubagents) {
    await params.workboard.closeSubagent({
      scope: params.scope,
      subagent_id: subagent.subagent_id,
      reason: params.reason,
      closedAtIso: occurredAtIso,
    });
    await params.workboard.markSubagentClosed({
      scope: params.scope,
      subagent_id: subagent.subagent_id,
      closedAtIso: occurredAtIso,
    });
  }

  return { activeSubagents, activeTasks };
}

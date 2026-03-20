import type { WorkItem, WorkItemTask, WorkScope } from "@tyrum/contracts";
import type { WorkboardRepository } from "./types.js";

export function buildPlannerInstruction(item: WorkItem): string {
  return [
    `You own refinement for WorkItem ${item.work_item_id}: ${item.title}`,
    "Use WorkBoard tools to inspect state, artifacts, decisions, and clarifications before acting.",
    "Request clarification through workboard.clarification.request only when scope is blocked on missing human input, not to ask for permission to proceed.",
    "If the work is large, decompose it into child work items or execution tasks.",
    "When scope, sizing, and decomposition are complete, transition the work item to ready.",
  ].join("\n");
}

export function buildExecutorInstruction(params: {
  item: WorkItem;
  task: WorkItemTask;
  tasks: WorkItemTask[];
  attachedNodeId?: string;
  resumed?: boolean;
}): string {
  const taskGraph = params.tasks
    .map((task) => {
      const dependsOn = task.depends_on.length > 0 ? task.depends_on.join(", ") : "none";
      const current = task.task_id === params.task.task_id ? " current_task=yes" : "";
      return `- ${task.task_id}: status=${task.status} profile=${task.execution_profile} depends_on=${dependsOn}${current}`;
    })
    .join("\n");
  const acceptance =
    params.item.acceptance === undefined ? "undefined" : JSON.stringify(params.item.acceptance);

  return [
    `You own execution for WorkItem ${params.item.work_item_id}: ${params.item.title}`,
    `Task ${params.task.task_id} profile=${params.task.execution_profile}`,
    "Use WorkBoard tools to record results and update task state. Request clarification only when blocked on missing human input, not to ask for permission to proceed.",
    ...(params.resumed
      ? [
          "This task was paused and resumed.",
          `Current work item snapshot: status=${params.item.status} priority=${params.item.priority} acceptance=${acceptance}`,
          "Current task graph snapshot:",
          taskGraph,
          "Operator edits may have changed prior assumptions. Treat this snapshot as authoritative before continuing.",
        ]
      : []),
    ...(params.attachedNodeId
      ? [`A managed desktop node is attached for this run: ${params.attachedNodeId}`]
      : []),
  ].join("\n");
}

export async function maybeFinalizeWorkItem(params: {
  repository: Pick<WorkboardRepository, "getItem" | "listTasks" | "transitionItem">;
  scope: WorkScope;
  workItemId: string;
}): Promise<void> {
  const allTasks = await params.repository.listTasks({
    scope: params.scope,
    work_item_id: params.workItemId,
  });
  const tasks = allTasks.filter((task) => task.execution_profile !== "planner");
  if (
    tasks.length > 0 &&
    tasks.every((task) => task.status === "completed" || task.status === "skipped")
  ) {
    const item = await params.repository.getItem({
      scope: params.scope,
      work_item_id: params.workItemId,
    });
    if (item?.status === "doing") {
      await params.repository.transitionItem({
        scope: params.scope,
        work_item_id: params.workItemId,
        status: "done",
        reason: "All execution tasks completed.",
      });
    }
  }
}

import type { WorkItem, WorkItemTask, WorkScope } from "@tyrum/schemas";
import { DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { AgentRegistry } from "../agent/registry.js";
import { DesktopEnvironmentDal, DesktopEnvironmentHostDal } from "../desktop-environments/dal.js";
import { DesktopEnvironmentLifecycleService } from "../desktop-environments/lifecycle-service.js";
import type { SessionLaneNodeAttachmentDal } from "../agent/session-lane-node-attachment-dal.js";
import { WorkboardDal } from "./dal.js";

export async function resolveAgentKeyById(params: {
  db: SqlDb;
  tenantId: string;
  agentId: string;
}): Promise<string> {
  const row = await params.db.get<{ agent_key: string }>(
    "SELECT agent_key FROM agents WHERE tenant_id = ? AND agent_id = ?",
    [params.tenantId, params.agentId],
  );
  const agentKey = row?.agent_key?.trim();
  if (!agentKey) {
    throw new Error("agent_key not found for work scope");
  }
  return agentKey;
}

export async function runManagedSubagentTurn(params: {
  agents: AgentRegistry;
  db: SqlDb;
  scope: WorkScope;
  subagent: {
    subagent_id: string;
    session_key: string;
    lane: string;
    agent_id: string;
    work_item_id?: string;
    work_item_task_id?: string;
    attached_node_id?: string;
  };
  message: string;
}): Promise<string> {
  const agentKey = await resolveAgentKeyById({
    db: params.db,
    tenantId: params.scope.tenant_id,
    agentId: params.subagent.agent_id,
  });
  const runtime = await params.agents.getRuntime({
    tenantId: params.scope.tenant_id,
    agentKey,
  });
  const response = await runtime.turn({
    channel: "subagent",
    thread_id: params.subagent.subagent_id,
    message: params.message,
    metadata: {
      tyrum_key: params.subagent.session_key,
      lane: params.subagent.lane,
      subagent_id: params.subagent.subagent_id,
      ...(params.subagent.work_item_id ? { work_item_id: params.subagent.work_item_id } : {}),
      ...(params.subagent.work_item_task_id
        ? { work_item_task_id: params.subagent.work_item_task_id }
        : {}),
      ...(params.subagent.attached_node_id
        ? { attached_node_id: params.subagent.attached_node_id }
        : {}),
    },
  });
  return response.reply ?? "";
}

export function buildPlannerInstruction(item: WorkItem): string {
  return [
    `You own refinement for WorkItem ${item.work_item_id}: ${item.title}`,
    "Use WorkBoard tools to inspect state, artifacts, decisions, and clarifications before acting.",
    "If the scope is unclear, request clarification through workboard.clarification.request.",
    "If the work is large, decompose it into child work items or execution tasks.",
    "When scope, sizing, and decomposition are complete, transition the work item to ready.",
  ].join("\n");
}

export function buildExecutorInstruction(params: {
  item: WorkItem;
  task: WorkItemTask;
  attachedNodeId?: string;
}): string {
  return [
    `You own execution for WorkItem ${params.item.work_item_id}: ${params.item.title}`,
    `Task ${params.task.task_id} profile=${params.task.execution_profile}`,
    "Use WorkBoard tools to record results, update task state, and request clarification if blocked.",
    ...(params.attachedNodeId
      ? [`A managed desktop node is attached for this run: ${params.attachedNodeId}`]
      : []),
  ].join("\n");
}

export async function provisionManagedDesktop(params: {
  db: SqlDb;
  tenantId: string;
  sessionLaneNodeAttachmentDal: SessionLaneNodeAttachmentDal;
  subagentSessionKey: string;
  subagentLane: string;
  label: string;
  updatedAtMs?: number;
}): Promise<{ desktopEnvironmentId: string; attachedNodeId?: string } | undefined> {
  const hostDal = new DesktopEnvironmentHostDal(params.db);
  const hosts = await hostDal.list();
  const host = hosts.find((candidate) => candidate.healthy && candidate.docker_available);
  if (!host) {
    return undefined;
  }

  const environmentDal = new DesktopEnvironmentDal(params.db);
  const environment = await environmentDal.create({
    tenantId: params.tenantId,
    hostId: host.host_id,
    label: params.label,
    imageRef: DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF,
    desiredRunning: true,
  });

  const deadline = Date.now() + 3_000;
  let current = environment;
  while (Date.now() < deadline && !current.node_id) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const refreshed = await environmentDal.get({
      tenantId: params.tenantId,
      environmentId: environment.environment_id,
    });
    if (!refreshed) break;
    current = refreshed;
  }

  if (current.node_id) {
    await params.sessionLaneNodeAttachmentDal.upsert({
      tenantId: params.tenantId,
      key: params.subagentSessionKey,
      lane: params.subagentLane,
      attachedNodeId: current.node_id,
      updatedAtMs: params.updatedAtMs,
    });
  }

  return {
    desktopEnvironmentId: current.environment_id,
    attachedNodeId: current.node_id ?? undefined,
  };
}

export async function cleanupManagedDesktop(params: {
  db: SqlDb;
  tenantId: string;
  environmentId: string;
}): Promise<void> {
  const environmentDal = new DesktopEnvironmentDal(params.db);
  const lifecycle = new DesktopEnvironmentLifecycleService(environmentDal);
  await lifecycle.deleteEnvironment({
    tenantId: params.tenantId,
    environmentId: params.environmentId,
  });
}

export async function maybeFinalizeWorkItem(params: {
  workboard: WorkboardDal;
  scope: WorkScope;
  workItemId: string;
}): Promise<void> {
  const tasks = await params.workboard.listTasks({
    scope: params.scope,
    work_item_id: params.workItemId,
  });
  if (
    tasks.length > 0 &&
    tasks.every((task) => task.status === "completed" || task.status === "skipped")
  ) {
    const item = await params.workboard.getItem({
      scope: params.scope,
      work_item_id: params.workItemId,
    });
    if (item?.status === "doing") {
      await params.workboard.transitionItem({
        scope: params.scope,
        work_item_id: params.workItemId,
        status: "done",
        reason: "All execution tasks completed.",
      });
    }
  }
}

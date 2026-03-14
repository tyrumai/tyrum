import type { AgentRegistry } from "./registry.js";
import type { ToolResult, WorkspaceLeaseConfig } from "./tool-executor-shared.js";
import type { SqlDb } from "../../statestore/types.js";
import type { WorkScope } from "@tyrum/schemas";
import { WorkboardDal } from "../workboard/dal.js";

export type WorkboardToolExecutorContext = {
  workspaceLease?: WorkspaceLeaseConfig;
  agents?: AgentRegistry;
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readString(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readNumber(
  record: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readStringArray(
  record: Record<string, unknown> | null,
  key: string,
): string[] | undefined {
  const value = record?.[key];
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return items.length > 0 ? items : [];
}

export function jsonResult(toolCallId: string, value: unknown): ToolResult {
  return {
    tool_call_id: toolCallId,
    output: JSON.stringify(value, null, 2),
  };
}

export function requireWorkScope(context: WorkboardToolExecutorContext): WorkScope {
  const tenantId = context.workspaceLease?.tenantId?.trim();
  const agentId = context.workspaceLease?.agentId?.trim();
  const workspaceId = context.workspaceLease?.workspaceId?.trim();
  if (!tenantId || !agentId || !workspaceId) {
    throw new Error("workboard tools are not configured");
  }
  return {
    tenant_id: tenantId,
    agent_id: agentId,
    workspace_id: workspaceId,
  };
}

export function requireDb(context: WorkboardToolExecutorContext): SqlDb {
  const db = context.workspaceLease?.db;
  if (!db) {
    throw new Error("workboard tools are not configured");
  }
  return db;
}

export function extractSubagentIdFromSessionKey(
  sessionKey: string | undefined,
): string | undefined {
  const normalized = sessionKey?.trim();
  if (!normalized) return undefined;
  const parts = normalized.split(":");
  if (parts.length !== 4) return undefined;
  if (parts[0] !== "agent" || parts[2] !== "subagent") return undefined;
  return parts[3]?.trim() || undefined;
}

export async function resolveClarificationTargetSessionKey(params: {
  db: SqlDb;
  scope: WorkScope;
  workItemId: string;
}): Promise<string> {
  const workboard = new WorkboardDal(params.db);
  const activity = await workboard.getScopeActivity({ scope: params.scope });
  if (activity?.last_active_session_key?.trim()) {
    return activity.last_active_session_key.trim();
  }

  const item = await workboard.getItem({
    scope: params.scope,
    work_item_id: params.workItemId,
  });
  if (!item?.created_from_session_key?.trim()) {
    throw new Error("unable to resolve clarification target session");
  }
  return item.created_from_session_key.trim();
}

export async function resolveAgentKeyById(params: {
  db: SqlDb;
  tenantId: string;
  agentId: string;
}): Promise<string> {
  const row = await params.db.get<{ agent_key: string }>(
    `SELECT agent_key
     FROM agents
     WHERE tenant_id = ? AND agent_id = ?`,
    [params.tenantId, params.agentId],
  );
  const agentKey = row?.agent_key?.trim();
  if (!agentKey) {
    throw new Error("agent_key not found for work scope");
  }
  return agentKey;
}

export async function runSubagentTurn(params: {
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

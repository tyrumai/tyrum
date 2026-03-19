import type { AgentRegistry } from "./registry.js";
import type { ToolResult, WorkspaceLeaseConfig } from "./tool-executor-shared.js";
import type { SqlDb } from "../../statestore/types.js";
import type { WorkScope } from "@tyrum/contracts";
import type { WorkboardBroadcastDeps } from "../workboard/item-broadcast.js";
import { WorkboardDal } from "../workboard/dal.js";
export { resolveAgentKeyById, runSubagentTurn } from "../workboard/subagent-runtime-support.js";

export type WorkboardToolExecutorContext = {
  workspaceLease?: WorkspaceLeaseConfig;
  agents?: AgentRegistry;
  broadcastDeps?: WorkboardBroadcastDeps;
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

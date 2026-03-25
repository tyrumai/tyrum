import { AgentMainKey, parseTyrumKey, SubagentConversationKey } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

type ManagedDesktopLane = "main" | "cron" | "heartbeat" | "subagent";

function parseManagedDesktopLane(value: string): ManagedDesktopLane {
  if (value === "main" || value === "cron" || value === "heartbeat" || value === "subagent") {
    return value;
  }
  throw new Error(`unsupported managed desktop lane '${value}'`);
}

export async function ensureManagedDesktopHandoffTarget(input: {
  db: SqlDb;
  tenantId: string;
  key: string;
  lane: ManagedDesktopLane;
}): Promise<void> {
  const lane = parseManagedDesktopLane(input.lane);
  if (lane === "subagent") {
    const parsed = SubagentConversationKey.safeParse(input.key);
    if (!parsed.success) {
      throw new Error("target_key must be a valid subagent session key for lane=subagent");
    }
    const exists = await input.db.get<{ session_key: string }>(
      `SELECT session_key
       FROM subagents
       WHERE tenant_id = ? AND session_key = ? AND lane = ?
       LIMIT 1`,
      [input.tenantId, parsed.data, lane],
    );
    if (!exists) {
      throw new Error("target subagent lane was not found in the current tenant");
    }
    return;
  }

  if (lane === "main") {
    const exists = await input.db.get<{ session_key: string }>(
      `SELECT session_key
       FROM sessions
       WHERE tenant_id = ? AND session_key = ?
       LIMIT 1`,
      [input.tenantId, input.key],
    );
    if (!exists) {
      throw new Error("target main lane session was not found in the current tenant");
    }
    return;
  }

  if (lane === "heartbeat") {
    const parsed = AgentMainKey.safeParse(input.key);
    if (!parsed.success) {
      throw new Error("target_key must be agent:<agentKey>:main for lane=heartbeat");
    }
    const key = parseTyrumKey(parsed.data);
    if (key.kind !== "agent") {
      throw new Error("target heartbeat lane must resolve to an agent key");
    }
    const exists = await input.db.get<{ agent_id: string }>(
      `SELECT agent_id
       FROM agents
       WHERE tenant_id = ? AND agent_key = ?
       LIMIT 1`,
      [input.tenantId, key.agent_key],
    );
    if (!exists) {
      throw new Error("target heartbeat lane agent was not found in the current tenant");
    }
    return;
  }

  const watcherMatch = input.key.match(/^cron:watcher:(.+)$/);
  const legacyWatcherMatch = input.key.match(/^cron:watcher-(.+)$/);
  const watcherId = watcherMatch?.[1] ?? legacyWatcherMatch?.[1];
  if (!watcherId) {
    throw new Error("target_key must reference a persisted watcher for lane=cron");
  }
  const exists = await input.db.get<{ watcher_id: string }>(
    `SELECT watcher_id
     FROM watchers
     WHERE tenant_id = ? AND watcher_id = ?
     LIMIT 1`,
    [input.tenantId, watcherId],
  );
  if (!exists) {
    throw new Error("target cron lane watcher was not found in the current tenant");
  }
}

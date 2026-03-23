import { IdentityScopeDal } from "../../app/modules/identity/scope.js";
import type { RawSessionListRow } from "../../app/modules/agent/session-dal-helpers.js";
import { toSessionListRow } from "../../app/modules/agent/session-dal-helpers.js";
import type { RawSubagentRow } from "../../app/modules/workboard/dal-helpers.js";
import { resolveWorkspaceKey } from "../../app/modules/workspace/id.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import {
  decodeSessionCursor,
  encodeSessionCursor,
} from "../../app/modules/agent/session-dal-runtime.js";
import { buildSqlPlaceholders } from "../../utils/sql.js";
import type { ProtocolDeps } from "./types.js";
import type { ListSessionRecordsResult, SessionRecord } from "./transcript-handlers.types.js";

const SUBAGENT_DESCENDANT_PARENT_BATCH_SIZE = 64;

export async function resolveWorkspaceId(
  deps: ProtocolDeps,
  tenantId: string,
): Promise<{ identityScopeDal: IdentityScopeDal; workspaceId: string }> {
  if (!deps.db) {
    throw new Error("missing db");
  }
  const identityScopeDal =
    deps.identityScopeDal ?? new IdentityScopeDal(deps.db, { cacheTtlMs: 60_000 });
  const workspaceId = await identityScopeDal.ensureWorkspaceId(tenantId, resolveWorkspaceKey());
  return { identityScopeDal, workspaceId };
}

export async function listSessionRecords(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  agentKey?: string;
  channel?: string;
  archived?: boolean;
  limit: number;
  cursor?: string;
}): Promise<ListSessionRecordsResult> {
  if (!input.deps.db) {
    throw new Error("missing db");
  }
  const where = ["s.tenant_id = ?", "s.workspace_id = ?"];
  const params: unknown[] = [input.tenantId, input.workspaceId];
  const cursor = input.cursor ? decodeSessionCursor(input.cursor) : undefined;
  if (input.cursor && !cursor) {
    throw new Error("invalid cursor");
  }

  if (input.agentKey) {
    where.push("ag.agent_key = ?");
    params.push(input.agentKey);
  }
  if (input.channel) {
    where.push("ca.connector_key = ?");
    params.push(input.channel);
  }
  if (input.archived === true) {
    where.push("s.archived_at IS NOT NULL");
  } else {
    where.push("s.archived_at IS NULL");
  }
  where.push("sa.parent_session_key IS NULL");
  if (cursor) {
    where.push("(s.updated_at < ? OR (s.updated_at = ? AND s.session_id < ?))");
    params.push(cursor.updated_at, cursor.updated_at, cursor.session_id);
  }

  const rows = await input.deps.db.all<RawSessionListRow>(
    `SELECT
       s.session_id,
       s.session_key,
       ag.agent_key,
       ca.connector_key,
       ct.provider_thread_id,
       s.title,
       s.messages_json,
       s.context_state_json,
       s.archived_at,
       s.created_at,
       s.updated_at
     FROM sessions s
     LEFT JOIN subagents sa
       ON sa.tenant_id = s.tenant_id
      AND sa.workspace_id = s.workspace_id
      AND sa.session_key = s.session_key
     JOIN agents ag
       ON ag.tenant_id = s.tenant_id
      AND ag.agent_id = s.agent_id
     JOIN channel_threads ct
       ON ct.tenant_id = s.tenant_id
      AND ct.workspace_id = s.workspace_id
      AND ct.channel_thread_id = s.channel_thread_id
     JOIN channel_accounts ca
       ON ca.tenant_id = ct.tenant_id
      AND ca.workspace_id = ct.workspace_id
      AND ca.channel_account_id = ct.channel_account_id
     WHERE ${where.join(" AND ")}
     ORDER BY s.updated_at DESC, s.session_id DESC
     LIMIT ?`,
    [...params, input.limit + 1],
  );

  const pageRows = rows.slice(0, input.limit);
  const nextCursor =
    rows.length > input.limit
      ? encodeSessionCursor({
          updated_at: normalizeDbDateTime(pageRows.at(-1)?.updated_at) ?? "",
          session_id: pageRows.at(-1)?.session_id ?? "",
        })
      : null;

  return {
    sessions: pageRows.map((row) => {
      const preview = toSessionListRow(row, {
        logger: input.deps.logger,
        metrics: undefined,
      });
      return {
        sessionId: row.session_id,
        sessionKey: row.session_key,
        agentKey: preview.agent_id,
        channel: preview.channel,
        threadId: preview.thread_id,
        title: preview.title,
        messageCount: preview.message_count,
        updatedAt: preview.updated_at,
        createdAt: preview.created_at,
        archived: preview.archived,
      };
    }),
    nextCursor,
  };
}

export async function listChildSessionRecords(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  rootSessionKeys: string[];
}): Promise<SessionRecord[]> {
  if (!input.deps.db || input.rootSessionKeys.length === 0) {
    return [];
  }

  const rows = await input.deps.db.all<RawSessionListRow>(
    `SELECT
       s.session_id,
       s.session_key,
       ag.agent_key,
       ca.connector_key,
       ct.provider_thread_id,
       s.title,
       s.messages_json,
       s.context_state_json,
       s.archived_at,
       s.created_at,
       s.updated_at
     FROM sessions s
     JOIN subagents sa
       ON sa.tenant_id = s.tenant_id
      AND sa.workspace_id = s.workspace_id
      AND sa.session_key = s.session_key
     JOIN agents ag
       ON ag.tenant_id = s.tenant_id
      AND ag.agent_id = s.agent_id
     JOIN channel_threads ct
       ON ct.tenant_id = s.tenant_id
      AND ct.workspace_id = s.workspace_id
      AND ct.channel_thread_id = s.channel_thread_id
     JOIN channel_accounts ca
       ON ca.tenant_id = ct.tenant_id
      AND ca.workspace_id = ct.workspace_id
      AND ca.channel_account_id = ct.channel_account_id
     WHERE s.tenant_id = ?
       AND s.workspace_id = ?
       AND sa.parent_session_key IN (${buildSqlPlaceholders(input.rootSessionKeys.length)})
     ORDER BY s.created_at ASC, s.session_id ASC`,
    [input.tenantId, input.workspaceId, ...input.rootSessionKeys],
  );

  return rows.map((row) => {
    const preview = toSessionListRow(row, {
      logger: input.deps.logger,
      metrics: undefined,
    });
    return {
      sessionId: row.session_id,
      sessionKey: row.session_key,
      agentKey: preview.agent_id,
      channel: preview.channel,
      threadId: preview.thread_id,
      title: preview.title,
      messageCount: preview.message_count,
      updatedAt: preview.updated_at,
      createdAt: preview.created_at,
      archived: preview.archived,
    };
  });
}

export async function listSessionRecordsByKeys(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  sessionKeys: string[];
}): Promise<SessionRecord[]> {
  if (!input.deps.db || input.sessionKeys.length === 0) {
    return [];
  }

  const rows = await input.deps.db.all<RawSessionListRow>(
    `SELECT
       s.session_id,
       s.session_key,
       ag.agent_key,
       ca.connector_key,
       ct.provider_thread_id,
       s.title,
       s.messages_json,
       s.context_state_json,
       s.archived_at,
       s.created_at,
       s.updated_at
     FROM sessions s
     JOIN agents ag
       ON ag.tenant_id = s.tenant_id
      AND ag.agent_id = s.agent_id
     JOIN channel_threads ct
       ON ct.tenant_id = s.tenant_id
      AND ct.workspace_id = s.workspace_id
      AND ct.channel_thread_id = s.channel_thread_id
     JOIN channel_accounts ca
       ON ca.tenant_id = ct.tenant_id
      AND ca.workspace_id = ct.workspace_id
      AND ca.channel_account_id = ct.channel_account_id
     WHERE s.tenant_id = ?
       AND s.workspace_id = ?
       AND s.session_key IN (${buildSqlPlaceholders(input.sessionKeys.length)})
     ORDER BY s.created_at ASC, s.session_id ASC`,
    [input.tenantId, input.workspaceId, ...input.sessionKeys],
  );

  return rows.map((row) => {
    const preview = toSessionListRow(row, {
      logger: input.deps.logger,
      metrics: undefined,
    });
    return {
      sessionId: row.session_id,
      sessionKey: row.session_key,
      agentKey: preview.agent_id,
      channel: preview.channel,
      threadId: preview.thread_id,
      title: preview.title,
      messageCount: preview.message_count,
      updatedAt: preview.updated_at,
      createdAt: preview.created_at,
      archived: preview.archived,
    };
  });
}

export async function listSubagentRows(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  agentId?: string;
  sessionKeys: string[];
}): Promise<RawSubagentRow[]> {
  if (!input.deps.db || input.sessionKeys.length === 0) {
    return [];
  }
  const where = [
    "tenant_id = ?",
    "workspace_id = ?",
    `session_key IN (${buildSqlPlaceholders(input.sessionKeys.length)})`,
  ];
  const params: unknown[] = [input.tenantId, input.workspaceId, ...input.sessionKeys];
  if (input.agentId) {
    where.splice(1, 0, "agent_id = ?");
    params.splice(1, 0, input.agentId);
  }

  return await input.deps.db.all<RawSubagentRow>(
    `SELECT *
     FROM subagents
     WHERE ${where.join(" AND ")}`,
    params,
  );
}

export async function getSubagentRowBySessionKey(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  sessionKey: string;
}): Promise<RawSubagentRow | undefined> {
  if (!input.deps.db) {
    throw new Error("missing db");
  }
  return input.deps.db.get<RawSubagentRow>(
    `SELECT *
     FROM subagents
     WHERE tenant_id = ?
       AND workspace_id = ?
       AND session_key = ?`,
    [input.tenantId, input.workspaceId, input.sessionKey],
  );
}

export async function listSubagentRowsByParentSessionKeys(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  parentSessionKeys: string[];
}): Promise<RawSubagentRow[]> {
  if (!input.deps.db || input.parentSessionKeys.length === 0) {
    return [];
  }
  return await input.deps.db.all<RawSubagentRow>(
    `SELECT *
     FROM subagents
     WHERE tenant_id = ?
       AND workspace_id = ?
       AND parent_session_key IN (${buildSqlPlaceholders(input.parentSessionKeys.length)})
     ORDER BY created_at ASC, subagent_id ASC`,
    [input.tenantId, input.workspaceId, ...input.parentSessionKeys],
  );
}

export async function loadDescendantSessionRecords(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  parentSessionKeys: string[];
}): Promise<SessionRecord[]> {
  const descendantSessionKeys: string[] = [];
  const seenDescendantSessionKeys = new Set<string>();
  const processedParentSessionKeys = new Set<string>();
  const queue = [...input.parentSessionKeys];

  while (queue.length > 0) {
    const parentSessionKeys: string[] = [];
    while (queue.length > 0 && parentSessionKeys.length < SUBAGENT_DESCENDANT_PARENT_BATCH_SIZE) {
      const parentSessionKey = queue.shift();
      if (!parentSessionKey || processedParentSessionKeys.has(parentSessionKey)) {
        continue;
      }
      processedParentSessionKeys.add(parentSessionKey);
      parentSessionKeys.push(parentSessionKey);
    }

    if (parentSessionKeys.length === 0) {
      continue;
    }

    const childRows = await listSubagentRowsByParentSessionKeys({
      deps: input.deps,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      parentSessionKeys,
    });
    for (const row of childRows) {
      if (seenDescendantSessionKeys.has(row.session_key)) {
        continue;
      }
      seenDescendantSessionKeys.add(row.session_key);
      descendantSessionKeys.push(row.session_key);
      queue.push(row.session_key);
    }
  }

  return await listSessionRecordsByKeys({
    deps: input.deps,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    sessionKeys: descendantSessionKeys,
  });
}

export async function loadLineageSubagentRows(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  focusSessionKey: string;
}): Promise<{
  subagentRows: RawSubagentRow[];
  rootSessionKey: string;
  lineageKeys: string[];
}> {
  const subagentRowsBySessionKey = new Map<string, RawSubagentRow>();
  const lineageKeysFromFocus: string[] = [input.focusSessionKey];
  const visitedAncestorSessionKeys = new Set<string>([input.focusSessionKey]);

  let rootSessionKey = input.focusSessionKey;
  let currentRow = await getSubagentRowBySessionKey({
    deps: input.deps,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    sessionKey: input.focusSessionKey,
  });
  if (currentRow) {
    subagentRowsBySessionKey.set(currentRow.session_key, currentRow);
  }

  while (currentRow?.parent_session_key) {
    const parentSessionKey = currentRow.parent_session_key;
    if (visitedAncestorSessionKeys.has(parentSessionKey)) {
      break;
    }
    visitedAncestorSessionKeys.add(parentSessionKey);
    rootSessionKey = parentSessionKey;
    lineageKeysFromFocus.push(parentSessionKey);

    const parentRow = await getSubagentRowBySessionKey({
      deps: input.deps,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      sessionKey: parentSessionKey,
    });
    if (!parentRow) {
      break;
    }
    currentRow = parentRow;
    subagentRowsBySessionKey.set(currentRow.session_key, currentRow);
  }

  const lineageKeys = lineageKeysFromFocus.toReversed();
  const lineageSessionKeySet = new Set<string>(lineageKeys);
  const descendantRows = await loadDescendantSubagentRows({
    deps: input.deps,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    parentSessionKeys: [rootSessionKey],
  });

  for (const row of descendantRows) {
    if (!subagentRowsBySessionKey.has(row.session_key)) {
      subagentRowsBySessionKey.set(row.session_key, row);
    }
    if (!lineageSessionKeySet.has(row.session_key)) {
      lineageSessionKeySet.add(row.session_key);
      lineageKeys.push(row.session_key);
    }
  }

  return {
    subagentRows: [...subagentRowsBySessionKey.values()],
    rootSessionKey,
    lineageKeys,
  };
}

async function loadDescendantSubagentRows(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  parentSessionKeys: string[];
}): Promise<RawSubagentRow[]> {
  const rowsBySessionKey = new Map<string, RawSubagentRow>();
  const processedParentSessionKeys = new Set<string>();
  const queue = [...input.parentSessionKeys];

  while (queue.length > 0) {
    const parentSessionKeys: string[] = [];
    while (queue.length > 0 && parentSessionKeys.length < SUBAGENT_DESCENDANT_PARENT_BATCH_SIZE) {
      const parentSessionKey = queue.shift();
      if (!parentSessionKey || processedParentSessionKeys.has(parentSessionKey)) {
        continue;
      }
      processedParentSessionKeys.add(parentSessionKey);
      parentSessionKeys.push(parentSessionKey);
    }

    if (parentSessionKeys.length === 0) {
      continue;
    }

    const childRows = await listSubagentRowsByParentSessionKeys({
      deps: input.deps,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      parentSessionKeys,
    });
    for (const row of childRows) {
      if (!rowsBySessionKey.has(row.session_key)) {
        rowsBySessionKey.set(row.session_key, row);
      }
      queue.push(row.session_key);
    }
  }

  return [...rowsBySessionKey.values()];
}

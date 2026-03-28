import { IdentityScopeDal } from "../../app/modules/identity/scope.js";
import type { RawConversationListRow } from "../../app/modules/agent/conversation-dal-helpers.js";
import {
  buildConversationSelectSql,
  toConversationListRow,
} from "../../app/modules/agent/conversation-dal-helpers.js";
import type { RawSubagentRow } from "../../app/modules/workboard/dal-helpers.js";
import { resolveWorkspaceKey } from "../../app/modules/workspace/id.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import {
  decodeConversationCursor,
  encodeConversationCursor,
} from "../../app/modules/agent/conversation-dal-runtime.js";
import { buildSqlPlaceholders } from "../../utils/sql.js";
import type { ProtocolDeps } from "./types.js";
import type {
  ListConversationRecordsResult,
  ConversationRecord,
} from "./transcript-handlers.types.js";

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

export async function listConversationRecords(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  agentKey?: string;
  channel?: string;
  archived?: boolean;
  limit: number;
  cursor?: string;
}): Promise<ListConversationRecordsResult> {
  if (!input.deps.db) {
    throw new Error("missing db");
  }
  const where = ["s.tenant_id = ?", "s.workspace_id = ?"];
  const params: unknown[] = [input.tenantId, input.workspaceId];
  const cursor = input.cursor ? decodeConversationCursor(input.cursor) : undefined;
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
  where.push("sa.parent_conversation_key IS NULL");
  if (cursor) {
    where.push("(s.updated_at < ? OR (s.updated_at = ? AND s.conversation_id < ?))");
    params.push(cursor.updated_at, cursor.updated_at, cursor.conversation_id);
  }

  const rows = await input.deps.db.all<RawConversationListRow>(
    `SELECT
       ${buildConversationSelectSql(input.deps.db.kind, "s")},
       ag.agent_key,
       ca.connector_key,
      ca.account_key,
      ct.provider_thread_id,
      ct.container_kind
     FROM conversations s
     LEFT JOIN subagents sa
       ON sa.tenant_id = s.tenant_id
      AND sa.workspace_id = s.workspace_id
      AND sa.conversation_key = s.conversation_key
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
     ORDER BY s.updated_at DESC, s.conversation_id DESC
     LIMIT ?`,
    [...params, input.limit + 1],
  );

  const pageRows = rows.slice(0, input.limit);
  const nextCursor =
    rows.length > input.limit
      ? encodeConversationCursor({
          updated_at: normalizeDbDateTime(pageRows.at(-1)?.updated_at) ?? "",
          conversation_id: pageRows.at(-1)?.conversation_id ?? "",
        })
      : null;

  return {
    conversations: pageRows.map((row) => {
      const preview = toConversationListRow(row, {
        logger: input.deps.logger,
        metrics: undefined,
      });
      return {
        conversationId: row.conversation_id,
        conversationKey: row.conversation_key,
        agentKey: preview.agent_key,
        channel: preview.channel,
        accountKey: preview.account_key ?? null,
        threadId: preview.thread_id,
        containerKind: preview.container_kind ?? null,
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

export async function listChildConversationRecords(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  rootConversationKeys: string[];
}): Promise<ConversationRecord[]> {
  if (!input.deps.db || input.rootConversationKeys.length === 0) {
    return [];
  }

  const rows = await input.deps.db.all<RawConversationListRow>(
    `SELECT
       ${buildConversationSelectSql(input.deps.db.kind, "s")},
       ag.agent_key,
       ca.connector_key,
       ca.account_key,
       ct.provider_thread_id,
       ct.container_kind
     FROM conversations s
     JOIN subagents sa
       ON sa.tenant_id = s.tenant_id
      AND sa.workspace_id = s.workspace_id
      AND sa.conversation_key = s.conversation_key
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
       AND sa.parent_conversation_key IN (${buildSqlPlaceholders(input.rootConversationKeys.length)})
     ORDER BY s.created_at ASC, s.conversation_id ASC`,
    [input.tenantId, input.workspaceId, ...input.rootConversationKeys],
  );

  return rows.map((row) => {
    const preview = toConversationListRow(row, {
      logger: input.deps.logger,
      metrics: undefined,
    });
    return {
      conversationId: row.conversation_id,
      conversationKey: row.conversation_key,
      agentKey: preview.agent_key,
      channel: preview.channel,
      accountKey: preview.account_key ?? null,
      threadId: preview.thread_id,
      containerKind: preview.container_kind ?? null,
      title: preview.title,
      messageCount: preview.message_count,
      updatedAt: preview.updated_at,
      createdAt: preview.created_at,
      archived: preview.archived,
    };
  });
}

export async function listConversationRecordsByKeys(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  conversationKeys: string[];
}): Promise<ConversationRecord[]> {
  if (!input.deps.db || input.conversationKeys.length === 0) {
    return [];
  }

  const rows = await input.deps.db.all<RawConversationListRow>(
    `SELECT
       ${buildConversationSelectSql(input.deps.db.kind, "s")},
       ag.agent_key,
       ca.connector_key,
       ca.account_key,
       ct.provider_thread_id,
       ct.container_kind
     FROM conversations s
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
       AND s.conversation_key IN (${buildSqlPlaceholders(input.conversationKeys.length)})
     ORDER BY s.created_at ASC, s.conversation_id ASC`,
    [input.tenantId, input.workspaceId, ...input.conversationKeys],
  );

  return rows.map((row) => {
    const preview = toConversationListRow(row, {
      logger: input.deps.logger,
      metrics: undefined,
    });
    return {
      conversationId: row.conversation_id,
      conversationKey: row.conversation_key,
      agentKey: preview.agent_key,
      channel: preview.channel,
      accountKey: preview.account_key ?? null,
      threadId: preview.thread_id,
      containerKind: preview.container_kind ?? null,
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
  conversationKeys: string[];
}): Promise<RawSubagentRow[]> {
  if (!input.deps.db || input.conversationKeys.length === 0) {
    return [];
  }
  const where = [
    "tenant_id = ?",
    "workspace_id = ?",
    `conversation_key IN (${buildSqlPlaceholders(input.conversationKeys.length)})`,
  ];
  const params: unknown[] = [input.tenantId, input.workspaceId, ...input.conversationKeys];
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

export async function getSubagentRowByConversationKey(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  conversationKey: string;
}): Promise<RawSubagentRow | undefined> {
  if (!input.deps.db) {
    throw new Error("missing db");
  }
  return input.deps.db.get<RawSubagentRow>(
    `SELECT *
     FROM subagents
     WHERE tenant_id = ?
       AND workspace_id = ?
       AND conversation_key = ?`,
    [input.tenantId, input.workspaceId, input.conversationKey],
  );
}

export async function listSubagentRowsByParentConversationKeys(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  parentConversationKeys: string[];
}): Promise<RawSubagentRow[]> {
  if (!input.deps.db || input.parentConversationKeys.length === 0) {
    return [];
  }
  return await input.deps.db.all<RawSubagentRow>(
    `SELECT *
     FROM subagents
     WHERE tenant_id = ?
       AND workspace_id = ?
       AND parent_conversation_key IN (${buildSqlPlaceholders(input.parentConversationKeys.length)})
     ORDER BY created_at ASC, subagent_id ASC`,
    [input.tenantId, input.workspaceId, ...input.parentConversationKeys],
  );
}

export async function loadDescendantConversationRecords(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  parentConversationKeys: string[];
}): Promise<ConversationRecord[]> {
  const descendantConversationKeys: string[] = [];
  const seenDescendantConversationKeys = new Set<string>();
  const processedParentConversationKeys = new Set<string>();
  const queue = [...input.parentConversationKeys];

  while (queue.length > 0) {
    const parentConversationKeys: string[] = [];
    while (
      queue.length > 0 &&
      parentConversationKeys.length < SUBAGENT_DESCENDANT_PARENT_BATCH_SIZE
    ) {
      const parentConversationKey = queue.shift();
      if (!parentConversationKey || processedParentConversationKeys.has(parentConversationKey)) {
        continue;
      }
      processedParentConversationKeys.add(parentConversationKey);
      parentConversationKeys.push(parentConversationKey);
    }

    if (parentConversationKeys.length === 0) {
      continue;
    }

    const childRows = await listSubagentRowsByParentConversationKeys({
      deps: input.deps,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      parentConversationKeys,
    });
    for (const row of childRows) {
      if (seenDescendantConversationKeys.has(row.conversation_key)) {
        continue;
      }
      seenDescendantConversationKeys.add(row.conversation_key);
      descendantConversationKeys.push(row.conversation_key);
      queue.push(row.conversation_key);
    }
  }

  return await listConversationRecordsByKeys({
    deps: input.deps,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationKeys: descendantConversationKeys,
  });
}

export async function loadLineageSubagentRows(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  focusConversationKey: string;
}): Promise<{
  subagentRows: RawSubagentRow[];
  rootConversationKey: string;
  lineageKeys: string[];
}> {
  const subagentRowsByConversationKey = new Map<string, RawSubagentRow>();
  const lineageKeysFromFocus: string[] = [input.focusConversationKey];
  const visitedAncestorConversationKeys = new Set<string>([input.focusConversationKey]);

  let rootConversationKey = input.focusConversationKey;
  let currentRow = await getSubagentRowByConversationKey({
    deps: input.deps,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationKey: input.focusConversationKey,
  });
  if (currentRow) {
    subagentRowsByConversationKey.set(currentRow.conversation_key, currentRow);
  }

  while (currentRow?.parent_conversation_key) {
    const parentConversationKey = currentRow.parent_conversation_key;
    if (visitedAncestorConversationKeys.has(parentConversationKey)) {
      break;
    }
    visitedAncestorConversationKeys.add(parentConversationKey);
    rootConversationKey = parentConversationKey;
    lineageKeysFromFocus.push(parentConversationKey);

    const parentRow = await getSubagentRowByConversationKey({
      deps: input.deps,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      conversationKey: parentConversationKey,
    });
    if (!parentRow) {
      break;
    }
    currentRow = parentRow;
    subagentRowsByConversationKey.set(currentRow.conversation_key, currentRow);
  }

  const lineageKeys = lineageKeysFromFocus.toReversed();
  const lineageConversationKeySet = new Set<string>(lineageKeys);
  const descendantRows = await loadDescendantSubagentRows({
    deps: input.deps,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    parentConversationKeys: [rootConversationKey],
  });

  for (const row of descendantRows) {
    if (!subagentRowsByConversationKey.has(row.conversation_key)) {
      subagentRowsByConversationKey.set(row.conversation_key, row);
    }
    if (!lineageConversationKeySet.has(row.conversation_key)) {
      lineageConversationKeySet.add(row.conversation_key);
      lineageKeys.push(row.conversation_key);
    }
  }

  return {
    subagentRows: [...subagentRowsByConversationKey.values()],
    rootConversationKey,
    lineageKeys,
  };
}

async function loadDescendantSubagentRows(input: {
  deps: ProtocolDeps;
  tenantId: string;
  workspaceId: string;
  parentConversationKeys: string[];
}): Promise<RawSubagentRow[]> {
  const rowsByConversationKey = new Map<string, RawSubagentRow>();
  const processedParentConversationKeys = new Set<string>();
  const queue = [...input.parentConversationKeys];

  while (queue.length > 0) {
    const parentConversationKeys: string[] = [];
    while (
      queue.length > 0 &&
      parentConversationKeys.length < SUBAGENT_DESCENDANT_PARENT_BATCH_SIZE
    ) {
      const parentConversationKey = queue.shift();
      if (!parentConversationKey || processedParentConversationKeys.has(parentConversationKey)) {
        continue;
      }
      processedParentConversationKeys.add(parentConversationKey);
      parentConversationKeys.push(parentConversationKey);
    }

    if (parentConversationKeys.length === 0) {
      continue;
    }

    const childRows = await listSubagentRowsByParentConversationKeys({
      deps: input.deps,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      parentConversationKeys,
    });
    for (const row of childRows) {
      if (!rowsByConversationKey.has(row.conversation_key)) {
        rowsByConversationKey.set(row.conversation_key, row);
      }
      queue.push(row.conversation_key);
    }
  }

  return [...rowsByConversationKey.values()];
}

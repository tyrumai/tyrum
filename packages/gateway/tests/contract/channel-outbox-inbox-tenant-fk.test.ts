import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { DEFAULT_AGENT_KEY, DEFAULT_WORKSPACE_KEY } from "../../src/modules/identity/scope.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { DEFAULT_CHANNEL_ACCOUNT_ID } from "../../src/modules/channels/interface.js";

type TestConversationRow = {
  tenant_id: string;
  workspace_id: string;
  conversation_id: string;
  channel_thread_id: string;
};

async function createConversation(db: SqlDb, tenantKey: string): Promise<TestConversationRow> {
  const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
  const channelThreadDal = new ChannelThreadDal(db);
  const tenantId = await identityScopeDal.ensureTenantId(tenantKey);
  const agentId = await identityScopeDal.ensureAgentId(tenantId, DEFAULT_AGENT_KEY);
  const workspaceId = await identityScopeDal.ensureWorkspaceId(tenantId, DEFAULT_WORKSPACE_KEY);
  await identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

  const channelAccountId = await channelThreadDal.ensureChannelAccountId({
    tenantId,
    workspaceId,
    connectorKey: "ui",
    accountKey: DEFAULT_CHANNEL_ACCOUNT_ID,
  });
  const channelThreadId = await channelThreadDal.ensureChannelThreadId({
    tenantId,
    workspaceId,
    channelAccountId,
    providerThreadId: `thread-${tenantKey}`,
    containerKind: "group",
  });

  const conversationId = randomUUID();
  await db.run(
    `INSERT INTO conversations (
       tenant_id,
       conversation_id,
       conversation_key,
       agent_id,
       workspace_id,
       channel_thread_id,
       title,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      tenantId,
      conversationId,
      `agent:default:ui:group:thread-${tenantKey}`,
      agentId,
      workspaceId,
      channelThreadId,
    ],
  );

  return {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    conversation_id: conversationId,
    channel_thread_id: channelThreadId,
  };
}

async function insertInboxRow(
  db: SqlDb,
  input: {
    tenantId: string;
    workspaceId: string;
    conversationId: string;
    channelThreadId: string;
    messageId: string;
  },
): Promise<number> {
  if (db.kind === "postgres") {
    const inserted = await db.get<{ inbox_id: number }>(
      `INSERT INTO channel_inbox (
         tenant_id,
         source,
         thread_id,
         message_id,
         key,
         queue_mode,
         received_at_ms,
         payload_json,
         workspace_id,
         conversation_id,
         channel_thread_id
       )
       VALUES (?, 'test', 'thread', ?, 'k', 'collect', 1, '{}', ?, ?, ?)
       RETURNING inbox_id`,
      [
        input.tenantId,
        input.messageId,
        input.workspaceId,
        input.conversationId,
        input.channelThreadId,
      ],
    );
    if (!inserted?.inbox_id) throw new Error("expected inbox_id from INSERT ... RETURNING");
    return inserted.inbox_id;
  }

  await db.run(
    `INSERT INTO channel_inbox (
       tenant_id,
       source,
       thread_id,
       message_id,
       key,
       queue_mode,
       received_at_ms,
       payload_json,
       workspace_id,
       conversation_id,
       channel_thread_id
     )
     VALUES (?, 'test', 'thread', ?, 'k', 'collect', 1, '{}', ?, ?, ?)`,
    [
      input.tenantId,
      input.messageId,
      input.workspaceId,
      input.conversationId,
      input.channelThreadId,
    ],
  );
  const row = await db.get<{ inbox_id: number }>("SELECT last_insert_rowid() AS inbox_id");
  if (!row?.inbox_id) throw new Error("expected last_insert_rowid()");
  return row.inbox_id;
}

async function insertOutboxRow(
  db: SqlDb,
  input: {
    tenantId: string;
    inboxId: number;
    conversationId: string;
    workspaceId: string;
    channelThreadId: string;
    dedupeKey: string;
  },
): Promise<void> {
  await db.run(
    `INSERT INTO channel_outbox (
       tenant_id,
       inbox_id,
       source,
       thread_id,
       dedupe_key,
       text,
       workspace_id,
       conversation_id,
       channel_thread_id
     )
     VALUES (?, ?, 'test', 'thread', ?, 'hello', ?, ?, ?)`,
    [
      input.tenantId,
      input.inboxId,
      input.dedupeKey,
      input.workspaceId,
      input.conversationId,
      input.channelThreadId,
    ],
  );
}

describe("tenant-scoped FK: channel_outbox → channel_inbox", () => {
  it("rejects cross-tenant linkage (sqlite)", async () => {
    const db = openTestSqliteDb();
    try {
      const t1 = await createConversation(db, "t1");
      const t2 = await createConversation(db, "t2");

      const inbox2 = await insertInboxRow(db, {
        tenantId: t2.tenant_id,
        workspaceId: t2.workspace_id,
        conversationId: t2.conversation_id,
        channelThreadId: t2.channel_thread_id,
        messageId: "m2",
      });

      await expect(
        insertOutboxRow(db, {
          tenantId: t1.tenant_id,
          inboxId: inbox2,
          conversationId: t1.conversation_id,
          workspaceId: t1.workspace_id,
          channelThreadId: t1.channel_thread_id,
          dedupeKey: "d1",
        }),
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it("rejects cross-tenant linkage (postgres)", async () => {
    const { db, close } = await openTestPostgresDb();
    try {
      const t1 = await createConversation(db, "t1");
      const t2 = await createConversation(db, "t2");

      const inbox2 = await insertInboxRow(db, {
        tenantId: t2.tenant_id,
        workspaceId: t2.workspace_id,
        conversationId: t2.conversation_id,
        channelThreadId: t2.channel_thread_id,
        messageId: "m2",
      });

      await expect(
        insertOutboxRow(db, {
          tenantId: t1.tenant_id,
          inboxId: inbox2,
          conversationId: t1.conversation_id,
          workspaceId: t1.workspace_id,
          channelThreadId: t1.channel_thread_id,
          dedupeKey: "d1",
        }),
      ).rejects.toThrow();
    } finally {
      await close();
    }
  });
});

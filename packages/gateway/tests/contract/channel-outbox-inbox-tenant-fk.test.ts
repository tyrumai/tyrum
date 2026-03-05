import { describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { SessionDal, type SessionRow } from "../../src/modules/agent/session-dal.js";

async function createSession(db: SqlDb, tenantKey: string): Promise<SessionRow> {
  const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
  const channelThreadDal = new ChannelThreadDal(db);
  const sessionDal = new SessionDal(db, identityScopeDal, channelThreadDal);
  return sessionDal.getOrCreate({
    scopeKeys: { tenantKey },
    connectorKey: "ui",
    providerThreadId: `thread-${tenantKey}`,
    containerKind: "group",
  });
}

async function insertInboxRow(
  db: SqlDb,
  input: {
    tenantId: string;
    workspaceId: string;
    sessionId: string;
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
         lane,
         received_at_ms,
         payload_json,
         workspace_id,
         session_id,
         channel_thread_id
       )
       VALUES (?, 'test', 'thread', ?, 'k', 'lane', 1, '{}', ?, ?, ?)
       RETURNING inbox_id`,
      [input.tenantId, input.messageId, input.workspaceId, input.sessionId, input.channelThreadId],
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
       lane,
       received_at_ms,
       payload_json,
       workspace_id,
       session_id,
       channel_thread_id
     )
     VALUES (?, 'test', 'thread', ?, 'k', 'lane', 1, '{}', ?, ?, ?)`,
    [input.tenantId, input.messageId, input.workspaceId, input.sessionId, input.channelThreadId],
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
    sessionId: string;
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
       session_id,
       channel_thread_id
     )
     VALUES (?, ?, 'test', 'thread', ?, 'hello', ?, ?, ?)`,
    [
      input.tenantId,
      input.inboxId,
      input.dedupeKey,
      input.workspaceId,
      input.sessionId,
      input.channelThreadId,
    ],
  );
}

describe("tenant-scoped FK: channel_outbox → channel_inbox", () => {
  it("rejects cross-tenant linkage (sqlite)", async () => {
    const db = openTestSqliteDb();
    try {
      const t1 = await createSession(db, "t1");
      const t2 = await createSession(db, "t2");

      const inbox2 = await insertInboxRow(db, {
        tenantId: t2.tenant_id,
        workspaceId: t2.workspace_id,
        sessionId: t2.session_id,
        channelThreadId: t2.channel_thread_id,
        messageId: "m2",
      });

      await expect(
        insertOutboxRow(db, {
          tenantId: t1.tenant_id,
          inboxId: inbox2,
          sessionId: t1.session_id,
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
      const t1 = await createSession(db, "t1");
      const t2 = await createSession(db, "t2");

      const inbox2 = await insertInboxRow(db, {
        tenantId: t2.tenant_id,
        workspaceId: t2.workspace_id,
        sessionId: t2.session_id,
        channelThreadId: t2.channel_thread_id,
        messageId: "m2",
      });

      await expect(
        insertOutboxRow(db, {
          tenantId: t1.tenant_id,
          inboxId: inbox2,
          sessionId: t1.session_id,
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

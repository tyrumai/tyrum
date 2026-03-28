import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ConversationDal } from "../../src/modules/agent/conversation-dal.js";
import { ConfiguredModelPresetDal } from "../../src/modules/models/configured-model-preset-dal.js";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";

export type SlashCommandFixture = {
  db: () => SqliteDb | undefined;
  setDb: (value: SqliteDb | undefined) => void;
  openDb: () => SqliteDb;
  ensureConversation: (input: {
    agentKey: string;
    channel: string;
    accountKey?: string;
    threadId: string;
    containerKind: "dm" | "group" | "channel";
  }) => Promise<Awaited<ReturnType<ConversationDal["getOrCreate"]>>>;
  insertChannelInboxRow: (input: {
    conversation: Awaited<ReturnType<ConversationDal["getOrCreate"]>>;
    source: string;
    threadId: string;
    messageId: string;
    key: string;
    receivedAtMs: number;
    status: "queued" | "processing" | "completed" | "failed";
  }) => Promise<number>;
  createConfiguredPreset: (input: {
    presetKey: string;
    displayName: string;
    providerKey: string;
    modelId: string;
    options?: Record<string, unknown>;
  }) => Promise<unknown>;
};

export function createSlashCommandFixture(): SlashCommandFixture {
  let db: SqliteDb | undefined;

  function openDb(): SqliteDb {
    db = openTestSqliteDb();
    return db;
  }

  async function ensureConversation(input: {
    agentKey: string;
    channel: string;
    accountKey?: string;
    threadId: string;
    containerKind: "dm" | "group" | "channel";
  }): Promise<Awaited<ReturnType<ConversationDal["getOrCreate"]>>> {
    if (!db) throw new Error("db not initialized");
    const conversationDal = new ConversationDal(
      db,
      new IdentityScopeDal(db),
      new ChannelThreadDal(db),
    );
    return await conversationDal.getOrCreate({
      scopeKeys: { agentKey: input.agentKey, workspaceKey: "default" },
      connectorKey: input.channel,
      accountKey: input.accountKey,
      providerThreadId: input.threadId,
      containerKind: input.containerKind,
    });
  }

  async function insertChannelInboxRow(input: {
    conversation: Awaited<ReturnType<ConversationDal["getOrCreate"]>>;
    source: string;
    threadId: string;
    messageId: string;
    key: string;
    receivedAtMs: number;
    status: "queued" | "processing" | "completed" | "failed";
  }): Promise<number> {
    if (!db) throw new Error("db not initialized");
    await db.run(
      `INSERT INTO channel_inbox (
         tenant_id,
         source,
         thread_id,
         message_id,
         key,
         received_at_ms,
         payload_json,
         status,
         workspace_id,
         conversation_id,
         channel_thread_id
       ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        input.source,
        input.threadId,
        input.messageId,
        input.key,
        input.receivedAtMs,
        input.status,
        DEFAULT_WORKSPACE_ID,
        input.conversation.conversation_id,
        input.conversation.channel_thread_id,
      ],
    );

    const row = await db.get<{ inbox_id: number }>(
      "SELECT inbox_id FROM channel_inbox WHERE message_id = ? ORDER BY inbox_id DESC LIMIT 1",
      [input.messageId],
    );
    if (!row) {
      throw new Error("channel_inbox insert failed");
    }
    return row.inbox_id;
  }

  async function createConfiguredPreset(input: {
    presetKey: string;
    displayName: string;
    providerKey: string;
    modelId: string;
    options?: Record<string, unknown>;
  }) {
    if (!db) throw new Error("db not initialized");
    return await new ConfiguredModelPresetDal(db).create({
      tenantId: DEFAULT_TENANT_ID,
      presetKey: input.presetKey,
      displayName: input.displayName,
      providerKey: input.providerKey,
      modelId: input.modelId,
      options: input.options ?? {},
    });
  }

  return {
    db: () => db,
    setDb: (value) => {
      db = value;
    },
    openDb,
    ensureConversation,
    insertChannelInboxRow,
    createConfiguredPreset,
  };
}

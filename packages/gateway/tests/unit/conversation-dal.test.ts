import { describe, expect, it } from "vitest";
import type { SqlDb } from "../../src/statestore/types.js";
import { ConversationDal } from "../../src/modules/agent/conversation-dal.js";
import { createTextMessage } from "../../src/modules/agent/conversation-dal-message-helpers.js";
import { createConversationContextStateForMessages } from "../../src/modules/agent/conversation-dal-runtime.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { createConversationDalFixture } from "./conversation-dal.test-support.js";

function createFailingConversationStateDb(db: SqlDb): SqlDb {
  const wrap = (inner: SqlDb): SqlDb => ({
    kind: inner.kind,
    get: async (sql, params) => await inner.get(sql, params),
    all: async (sql, params) => await inner.all(sql, params),
    run: async (sql, params) => {
      if (sql.includes("INSERT INTO conversation_state")) {
        throw new Error("state upsert failed");
      }
      return await inner.run(sql, params);
    },
    exec: async (sql) => await inner.exec(sql),
    transaction: async (fn) => await inner.transaction(async (tx) => await fn(wrap(tx))),
    close: async () => {},
  });
  return wrap(db);
}

describe("ConversationDal", () => {
  it("creates and retrieves conversations by channel/thread", async () => {
    const { dal } = createConversationDalFixture();
    const first = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });
    const second = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });

    expect(second.conversation_id).toBe(first.conversation_id);
    expect(second.messages).toEqual([]);
    expect(second.context_state.checkpoint).toBeNull();
  });

  it("replaces persisted messages and keeps recent ids in context state", async () => {
    const { dal } = createConversationDalFixture();
    const conversation = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });
    const messages = [
      createTextMessage({ id: "m1", role: "user", text: "hello" }),
      createTextMessage({ id: "m2", role: "assistant", text: "hi" }),
    ];

    await dal.replaceMessages({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      messages,
      updatedAt: "2026-02-17T00:00:00.000Z",
    });

    const updated = await dal.getById({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
    });
    expect(updated?.messages).toEqual(messages);
    expect(updated?.context_state.recent_message_ids).toEqual(["m1", "m2"]);
  });

  it("uses the conversation updated_at as a valid transcript timestamp fallback", async () => {
    const { dal } = createConversationDalFixture();
    const conversation = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });
    const messages = [
      createTextMessage({ id: "m1", role: "user", text: "hello" }),
      createTextMessage({ id: "m2", role: "assistant", text: "hi" }),
    ];

    await dal.replaceMessages({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      messages,
      updatedAt: "2026-02-17T00:00:00.000Z",
    });

    const updated = await dal.getById({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
    });

    expect(updated?.transcript).toEqual([
      {
        kind: "text",
        id: "m1",
        role: "user",
        content: "hello",
        created_at: "2026-02-17T00:00:00.000Z",
      },
      {
        kind: "text",
        id: "m2",
        role: "assistant",
        content: "hi",
        created_at: "2026-02-17T00:00:00.000Z",
      },
    ]);
  });

  it("replaces prompt context state without mutating persisted messages", async () => {
    const { dal } = createConversationDalFixture();
    const conversation = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });
    const messages = [createTextMessage({ id: "m1", role: "user", text: "hello" })];
    await dal.replaceMessages({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      messages,
      updatedAt: "2026-02-17T00:00:00.000Z",
    });
    await dal.replaceContextState({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      contextState: {
        ...createConversationContextStateForMessages(messages, "2026-02-17T00:01:00.000Z"),
        checkpoint: {
          goal: "",
          user_constraints: [],
          decisions: [],
          discoveries: [],
          completed_work: [],
          pending_work: ["follow up"],
          unresolved_questions: [],
          critical_identifiers: [],
          relevant_files: [],
          handoff_md: "checkpoint",
        },
      },
    });

    const updated = await dal.getById({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
    });
    expect(updated?.messages).toEqual(messages);
    expect(updated?.context_state.checkpoint?.handoff_md).toBe("checkpoint");
  });

  it("rolls back context-state writes when the state upsert fails", async () => {
    const { db, dal } = createConversationDalFixture();
    try {
      const conversation = await dal.getOrCreate({
        scopeKeys: { agentKey: "default", workspaceKey: "default" },
        connectorKey: "ui",
        providerThreadId: "thread-1",
        containerKind: "channel",
      });
      const messages = [createTextMessage({ id: "m1", role: "user", text: "hello" })];
      await dal.replaceMessages({
        tenantId: conversation.tenant_id,
        conversationId: conversation.conversation_id,
        messages,
        updatedAt: "2026-02-17T00:00:00.000Z",
      });

      const before = await dal.getById({
        tenantId: conversation.tenant_id,
        conversationId: conversation.conversation_id,
      });
      expect(before?.updated_at).toBe("2026-02-17T00:00:00.000Z");

      const failingDal = new ConversationDal(
        createFailingConversationStateDb(db),
        new IdentityScopeDal(db),
        new ChannelThreadDal(db),
      );

      await expect(
        failingDal.replaceContextState({
          tenantId: conversation.tenant_id,
          conversationId: conversation.conversation_id,
          updatedAt: "2026-02-17T00:01:00.000Z",
          contextState: {
            ...createConversationContextStateForMessages(messages, "2026-02-17T00:01:00.000Z"),
            checkpoint: {
              goal: "",
              user_constraints: [],
              decisions: [],
              discoveries: [],
              completed_work: [],
              pending_work: ["follow up"],
              unresolved_questions: [],
              critical_identifiers: [],
              relevant_files: [],
              handoff_md: "checkpoint",
            },
          },
        }),
      ).rejects.toThrow("state upsert failed");

      const after = await dal.getById({
        tenantId: conversation.tenant_id,
        conversationId: conversation.conversation_id,
      });
      expect(after?.updated_at).toBe(before?.updated_at);
      expect(after?.messages).toEqual(before?.messages);
      expect(after?.context_state).toEqual(before?.context_state);
    } finally {
      await db.close();
    }
  });

  it("rebuilds recent ids from the first persisted recent message that still exists", () => {
    const messages = [
      createTextMessage({ id: "m1", role: "user", text: "hello" }),
      createTextMessage({ id: "m2", role: "assistant", text: "hi" }),
      createTextMessage({ id: "m3", role: "user", text: "follow up" }),
    ];

    const state = createConversationContextStateForMessages(messages, "2026-02-17T00:02:00.000Z", {
      ...createConversationContextStateForMessages(messages, "2026-02-17T00:01:00.000Z"),
      recent_message_ids: ["missing-message", "m2"],
    });

    expect(state.recent_message_ids).toEqual(["m2", "m3"]);
  });
});

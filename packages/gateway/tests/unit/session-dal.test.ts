import { describe, expect, it } from "vitest";
import type { SqlDb } from "../../src/statestore/types.js";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { createTextMessage } from "../../src/modules/agent/session-dal-message-helpers.js";
import { createSessionContextStateForMessages } from "../../src/modules/agent/session-dal-runtime.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { createSessionDalFixture } from "./session-dal.test-support.js";

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

describe("SessionDal", () => {
  it("creates and retrieves sessions by channel/thread", async () => {
    const { dal } = createSessionDalFixture();
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

    expect(second.session_id).toBe(first.session_id);
    expect(second.messages).toEqual([]);
    expect(second.context_state.checkpoint).toBeNull();
  });

  it("replaces persisted messages and keeps recent ids in context state", async () => {
    const { dal } = createSessionDalFixture();
    const session = await dal.getOrCreate({
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
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      messages,
      updatedAt: "2026-02-17T00:00:00.000Z",
    });

    const updated = await dal.getById({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    expect(updated?.messages).toEqual(messages);
    expect(updated?.context_state.recent_message_ids).toEqual(["m1", "m2"]);
  });

  it("uses the session updated_at as a valid transcript timestamp fallback", async () => {
    const { dal } = createSessionDalFixture();
    const session = await dal.getOrCreate({
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
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      messages,
      updatedAt: "2026-02-17T00:00:00.000Z",
    });

    const updated = await dal.getById({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
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
    const { dal } = createSessionDalFixture();
    const session = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });
    const messages = [createTextMessage({ id: "m1", role: "user", text: "hello" })];
    await dal.replaceMessages({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      messages,
      updatedAt: "2026-02-17T00:00:00.000Z",
    });
    await dal.replaceContextState({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      contextState: {
        ...createSessionContextStateForMessages(messages, "2026-02-17T00:01:00.000Z"),
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
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    expect(updated?.messages).toEqual(messages);
    expect(updated?.context_state.checkpoint?.handoff_md).toBe("checkpoint");
  });

  it("rolls back context-state writes when the state upsert fails", async () => {
    const { db, dal } = createSessionDalFixture();
    try {
      const session = await dal.getOrCreate({
        scopeKeys: { agentKey: "default", workspaceKey: "default" },
        connectorKey: "ui",
        providerThreadId: "thread-1",
        containerKind: "channel",
      });
      const messages = [createTextMessage({ id: "m1", role: "user", text: "hello" })];
      await dal.replaceMessages({
        tenantId: session.tenant_id,
        sessionId: session.session_id,
        messages,
        updatedAt: "2026-02-17T00:00:00.000Z",
      });

      const before = await dal.getById({
        tenantId: session.tenant_id,
        sessionId: session.session_id,
      });
      expect(before?.updated_at).toBe("2026-02-17T00:00:00.000Z");

      const failingDal = new SessionDal(
        createFailingConversationStateDb(db),
        new IdentityScopeDal(db),
        new ChannelThreadDal(db),
      );

      await expect(
        failingDal.replaceContextState({
          tenantId: session.tenant_id,
          sessionId: session.session_id,
          updatedAt: "2026-02-17T00:01:00.000Z",
          contextState: {
            ...createSessionContextStateForMessages(messages, "2026-02-17T00:01:00.000Z"),
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
        tenantId: session.tenant_id,
        sessionId: session.session_id,
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

    const state = createSessionContextStateForMessages(messages, "2026-02-17T00:02:00.000Z", {
      ...createSessionContextStateForMessages(messages, "2026-02-17T00:01:00.000Z"),
      recent_message_ids: ["missing-message", "m2"],
    });

    expect(state.recent_message_ids).toEqual(["m2", "m3"]);
  });
});

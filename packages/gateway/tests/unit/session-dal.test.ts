import { describe, expect, it } from "vitest";
import { createTextMessage } from "../../src/modules/agent/session-dal-message-helpers.js";
import { createSessionContextStateForMessages } from "../../src/modules/agent/session-dal-runtime.js";
import { createSessionDalFixture } from "./session-dal.test-support.js";

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
});

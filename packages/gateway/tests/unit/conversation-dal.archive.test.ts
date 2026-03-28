import { describe, expect, it } from "vitest";
import { createConversationDalFixture } from "./conversation-dal.test-support.js";

describe("ConversationDal.setArchived", () => {
  it("archives a conversation", async () => {
    const { dal } = createConversationDalFixture();
    const conversation = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });

    expect(conversation.archived).toBe(false);

    const changed = await dal.setArchived({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      archived: true,
    });
    expect(changed).toBe(true);

    const updated = await dal.getById({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
    });
    expect(updated?.archived).toBe(true);
  });

  it("unarchives a conversation", async () => {
    const { dal } = createConversationDalFixture();
    const conversation = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });

    await dal.setArchived({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      archived: true,
    });

    await dal.setArchived({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      archived: false,
    });

    const updated = await dal.getById({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
    });
    expect(updated?.archived).toBe(false);
  });
});

describe("ConversationDal.list with archived filter", () => {
  it("excludes archived conversations by default", async () => {
    const { dal } = createConversationDalFixture();
    const s1 = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });
    const s2 = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-2",
      containerKind: "channel",
    });

    await dal.setArchived({
      tenantId: s1.tenant_id,
      conversationId: s1.conversation_id,
      archived: true,
    });

    const result = await dal.list({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
    });

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]?.conversation_id).toBe(s2.conversation_id);
  });

  it("returns only archived conversations when archived=true", async () => {
    const { dal } = createConversationDalFixture();
    const s1 = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });
    await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-2",
      containerKind: "channel",
    });

    await dal.setArchived({
      tenantId: s1.tenant_id,
      conversationId: s1.conversation_id,
      archived: true,
    });

    const result = await dal.list({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      archived: true,
    });

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]?.conversation_id).toBe(s1.conversation_id);
    expect(result.conversations[0]?.archived).toBe(true);
  });

  it("returns only active conversations when archived=false", async () => {
    const { dal } = createConversationDalFixture();
    const s1 = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });
    await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-2",
      containerKind: "channel",
    });

    await dal.setArchived({
      tenantId: s1.tenant_id,
      conversationId: s1.conversation_id,
      archived: true,
    });

    const result = await dal.list({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      archived: false,
    });

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]?.archived).toBe(false);
  });

  it("includes archived field in list row", async () => {
    const { dal } = createConversationDalFixture();
    await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });

    const result = await dal.list({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
    });

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]?.archived).toBe(false);
  });
});

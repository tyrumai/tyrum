import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";
import {
  createConversationDalFixture,
  setConversationUpdatedAt,
} from "./conversation-dal.test-support.js";
import {
  insertRunningExecution,
  insertRunningExecutionTrace,
  linkSubagentConversation,
} from "./transcript-handlers.test-support.js";

describe("transcript WS handlers", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function createTranscriptFixture() {
    const fixture = createConversationDalFixture();
    db = fixture.db;
    const subagentId = "550e8400-e29b-41d4-a716-446655440001";

    const root1 = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-root-1",
      containerKind: "group",
    });
    const child1 = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-child-1",
      containerKind: "group",
    });
    const childConversationKey = `agent:default:subagent:${subagentId}`;
    await linkSubagentConversation({
      db: db!,
      tenantId: child1.tenant_id,
      conversationId: child1.conversation_id,
      conversationKey: childConversationKey,
      subagentId,
      agentId: root1.agent_id,
      workspaceId: root1.workspace_id,
      parentConversationKey: root1.conversation_key,
      createdAt: "2026-02-17T00:00:30.000Z",
    });
    const root2 = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-root-2",
      containerKind: "group",
    });
    const root3 = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-root-3",
      containerKind: "group",
    });
    const otherTenant = await fixture.dal.getOrCreate({
      scopeKeys: { tenantKey: "tenant-b" },
      connectorKey: "ui",
      providerThreadId: "thread-other-tenant",
      containerKind: "group",
    });

    await setConversationUpdatedAt({
      db: db!,
      tenantId: root1.tenant_id,
      conversationIds: [root1.conversation_id],
      valueSql: "'2026-02-17T00:03:00.000Z'",
    });
    await setConversationUpdatedAt({
      db: db!,
      tenantId: root2.tenant_id,
      conversationIds: [root2.conversation_id],
      valueSql: "'2026-02-17T00:02:00.000Z'",
    });
    await setConversationUpdatedAt({
      db: db!,
      tenantId: root3.tenant_id,
      conversationIds: [root3.conversation_id],
      valueSql: "'2026-02-17T00:01:00.000Z'",
    });

    return {
      dal: fixture.dal,
      root1,
      child1: { ...child1, conversation_key: childConversationKey },
      root2,
      root3,
      otherTenant,
      subagentId,
    };
  }

  it("lists root transcripts with direct child summaries and cursor pagination", async () => {
    const { root1, child1, root2, root3, otherTenant } = await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    const page1 = (await handleClientMessage(
      client,
      serializeWsRequest({ type: "transcript.list", payload: { limit: 2 } }),
      deps,
    )) as {
      ok: boolean;
      result: {
        conversations: Array<{
          conversation_id: string;
          conversation_key: string;
          child_conversations?: Array<{ conversation_key: string }>;
        }>;
        next_cursor: string | null;
      };
    };
    expect(page1.ok).toBe(true);
    expect(page1.result.conversations.map((conversation) => conversation.conversation_key)).toEqual(
      [root1.conversation_key, root2.conversation_key],
    );
    expect(page1.result.conversations[0]?.conversation_id).toBe(root1.conversation_id);
    expect(
      page1.result.conversations[0]?.child_conversations?.map(
        (conversation) => conversation.conversation_key,
      ),
    ).toEqual([child1.conversation_key]);
    expect(
      page1.result.conversations.some(
        (conversation) => conversation.conversation_key === otherTenant.conversation_key,
      ),
    ).toBe(false);
    expect(page1.result.next_cursor).toEqual(expect.any(String));

    const page2 = (await handleClientMessage(
      client,
      serializeWsRequest({
        type: "transcript.list",
        payload: { limit: 2, cursor: page1.result.next_cursor },
      }),
      deps,
    )) as {
      ok: boolean;
      result: { conversations: Array<{ conversation_key: string }>; next_cursor: string | null };
    };

    expect(page2.ok).toBe(true);
    expect(page2.result.conversations.map((conversation) => conversation.conversation_key)).toEqual(
      [root3.conversation_key],
    );
    expect(page2.result.next_cursor).toBeNull();
  });

  it("rejects malformed transcript list cursors", async () => {
    await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    const response = await handleClientMessage(
      client,
      serializeWsRequest({
        type: "transcript.list",
        payload: { limit: 10, cursor: "not-a-valid-cursor" },
      }),
      deps,
    );

    expect(response).toMatchObject({
      ok: false,
      type: "transcript.list",
      error: {
        code: "invalid_request",
        message: "invalid cursor",
      },
    });
  });

  it("filters archived transcript roots via transcript.list", async () => {
    const { root1, root2 } = await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    await db!.run(
      "UPDATE conversations SET archived_at = ? WHERE tenant_id = ? AND conversation_id = ?",
      ["2026-02-18T00:00:00.000Z", root2.tenant_id, root2.conversation_id],
    );

    const activeResponse = (await handleClientMessage(
      client,
      serializeWsRequest({ type: "transcript.list", payload: { limit: 50 } }),
      deps,
    )) as {
      ok: boolean;
      result: { conversations: Array<{ conversation_key: string }> };
    };

    expect(activeResponse.ok).toBe(true);
    expect(
      activeResponse.result.conversations.map((conversation) => conversation.conversation_key),
    ).toContain(root1.conversation_key);
    expect(
      activeResponse.result.conversations.map((conversation) => conversation.conversation_key),
    ).not.toContain(root2.conversation_key);

    const archivedResponse = (await handleClientMessage(
      client,
      serializeWsRequest({
        type: "transcript.list",
        payload: { archived: true, limit: 50 },
      }),
      deps,
    )) as {
      ok: boolean;
      result: { conversations: Array<{ conversation_key: string; archived: boolean }> };
    };

    expect(archivedResponse.ok).toBe(true);
    expect(
      archivedResponse.result.conversations.map((conversation) => conversation.conversation_key),
    ).toEqual([root2.conversation_key]);
    expect(archivedResponse.result.conversations[0]?.archived).toBe(true);
  });

  it("filters transcript roots by agent_key and returns source metadata", async () => {
    const fixture = createConversationDalFixture();
    db = fixture.db;
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    const defaultRoot = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-default",
      containerKind: "group",
    });
    const otherAgentRoot = await fixture.dal.getOrCreate({
      scopeKeys: { agentKey: "agent-b" },
      connectorKey: "googlechat",
      accountKey: "ops",
      providerThreadId: "thread-agent-b",
      containerKind: "dm",
    });

    await setConversationUpdatedAt({
      db: db!,
      tenantId: defaultRoot.tenant_id,
      conversationIds: [defaultRoot.conversation_id, otherAgentRoot.conversation_id],
      valueSql: "'2026-02-17T00:05:00.000Z'",
    });

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({
        type: "transcript.list",
        payload: { agent_key: "agent-b", limit: 50 },
      }),
      deps,
    )) as {
      ok: boolean;
      result: {
        conversations: Array<{
          agent_key: string;
          conversation_key: string;
          channel: string;
          account_key?: string;
          container_kind?: string;
        }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.conversations).toEqual([
      expect.objectContaining({
        agent_key: "agent-b",
        conversation_key: otherAgentRoot.conversation_key,
        channel: "googlechat",
        account_key: "ops",
        container_kind: "dm",
      }),
    ]);
  });

  it("keeps a root transcript visible in active_only mode when a child conversation has an active run", async () => {
    const { child1, root1 } = await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    await insertRunningExecution({
      db: db!,
      tenantId: child1.tenant_id,
      agentId: child1.agent_id,
      workspaceId: child1.workspace_id,
      conversationKey: child1.conversation_key,
      jobId: "job-transcript-1",
      turnId: "550e8400-e29b-41d4-a716-446655440100",
      createdAt: "2026-02-17T00:04:00.000Z",
    });

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({ type: "transcript.list", payload: { active_only: true, limit: 50 } }),
      deps,
    )) as {
      ok: boolean;
      result: {
        conversations: Array<{
          conversation_key: string;
          child_conversations?: Array<{ conversation_key: string }>;
        }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.conversations).toHaveLength(1);
    expect(response.result.conversations[0]?.conversation_key).toBe(root1.conversation_key);
    expect(response.result.conversations[0]?.child_conversations?.[0]?.conversation_key).toBe(
      child1.conversation_key,
    );
  });

  it("keeps a root transcript visible in active_only mode when only a grandchild conversation is active", async () => {
    const { dal, child1, root1 } = await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };
    const grandchildSubagentId = "550e8400-e29b-41d4-a716-446655440002";

    const grandchild = await dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-grandchild-1",
      containerKind: "group",
    });
    const grandchildConversationKey = `agent:default:subagent:${grandchildSubagentId}`;
    await linkSubagentConversation({
      db: db!,
      tenantId: grandchild.tenant_id,
      conversationId: grandchild.conversation_id,
      conversationKey: grandchildConversationKey,
      subagentId: grandchildSubagentId,
      agentId: child1.agent_id,
      workspaceId: child1.workspace_id,
      parentConversationKey: child1.conversation_key,
      createdAt: "2026-02-17T00:00:45.000Z",
    });
    await insertRunningExecution({
      db: db!,
      tenantId: grandchild.tenant_id,
      agentId: grandchild.agent_id,
      workspaceId: grandchild.workspace_id,
      conversationKey: grandchildConversationKey,
      jobId: "job-transcript-grandchild-1",
      turnId: "550e8400-e29b-41d4-a716-446655440101",
      createdAt: "2026-02-17T00:04:30.000Z",
    });

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({ type: "transcript.list", payload: { active_only: true, limit: 50 } }),
      deps,
    )) as {
      ok: boolean;
      result: {
        conversations: Array<{
          conversation_key: string;
          child_conversations?: Array<{
            conversation_key: string;
            child_conversations?: Array<{ conversation_key: string }>;
          }>;
        }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.conversations).toHaveLength(1);
    expect(response.result.conversations[0]?.conversation_key).toBe(root1.conversation_key);
    expect(response.result.conversations[0]?.child_conversations?.[0]?.conversation_key).toBe(
      child1.conversation_key,
    );
    expect(
      response.result.conversations[0]?.child_conversations?.[0]?.child_conversations?.[0]
        ?.conversation_key,
    ).toBe(grandchildConversationKey);
  });

  it("resolves a child transcript to its root lineage and returns ordered events", async () => {
    const { dal, root1, child1, subagentId } = await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    await dal.replaceMessages({
      tenantId: root1.tenant_id,
      conversationId: root1.conversation_id,
      updatedAt: "2026-02-17T00:03:00.000Z",
      messages: [
        {
          id: "root-msg",
          role: "user",
          parts: [{ type: "text", text: "root prompt" }],
          metadata: { created_at: "2026-02-17T00:00:10.000Z" },
        },
      ],
    });
    await dal.replaceMessages({
      tenantId: child1.tenant_id,
      conversationId: child1.conversation_id,
      updatedAt: "2026-02-17T00:03:30.000Z",
      messages: [
        {
          id: "child-msg",
          role: "assistant",
          parts: [{ type: "text", text: "child reply" }],
          metadata: { created_at: "2026-02-17T00:00:10.000Z" },
        },
      ],
    });

    await insertRunningExecutionTrace({
      db: db!,
      tenantId: root1.tenant_id,
      agentId: root1.agent_id,
      workspaceId: root1.workspace_id,
      conversationKey: root1.conversation_key,
      jobId: "550e8400-e29b-41d4-a716-446655440201",
      turnId: "550e8400-e29b-41d4-a716-446655440200",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964aa",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d0f",
      createdAt: "2026-02-17T00:00:20.000Z",
    });

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({
        type: "transcript.get",
        payload: { conversation_key: child1.conversation_key },
      }),
      deps,
    )) as {
      ok: boolean;
      result: {
        root_conversation_key: string;
        focus_conversation_key: string;
        conversations: Array<{ conversation_key: string }>;
        events: Array<{ kind: string; event_id: string }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.root_conversation_key).toBe(root1.conversation_key);
    expect(response.result.focus_conversation_key).toBe(child1.conversation_key);
    expect(
      response.result.conversations.map((conversation) => conversation.conversation_key),
    ).toEqual([root1.conversation_key, child1.conversation_key]);
    expect(response.result.events.map((event) => event.kind)).toEqual([
      "message",
      "message",
      "turn",
      "subagent",
    ]);
    const [firstMessageId, secondMessageId, turnId, subagentEventId] = response.result.events.map(
      (event) => event.event_id,
    );
    expect([firstMessageId, secondMessageId]).toEqual(
      [
        `message:${root1.conversation_key}:root-msg`,
        `message:${child1.conversation_key}:child-msg`,
      ].toSorted(),
    );
    expect(turnId).toBe("turn:550e8400-e29b-41d4-a716-446655440200");
    expect(subagentEventId).toBe(`subagent:${subagentId}:spawned`);
  });

  it("includes approval events in transcript.get when approvals are linked to transcript runs", async () => {
    const { root1 } = await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    await insertRunningExecutionTrace({
      db: db!,
      tenantId: root1.tenant_id,
      agentId: root1.agent_id,
      workspaceId: root1.workspace_id,
      conversationKey: root1.conversation_key,
      jobId: "550e8400-e29b-41d4-a716-446655440301",
      turnId: "550e8400-e29b-41d4-a716-446655440300",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ab",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d1a",
      createdAt: "2026-02-17T00:00:20.000Z",
    });

    const approval = await new ApprovalDal(db!).create({
      tenantId: root1.tenant_id,
      agentId: root1.agent_id,
      workspaceId: root1.workspace_id,
      approvalKey: "approval:transcript-run-1",
      prompt: "Approve transcript run?",
      motivation: "Approve transcript run?",
      kind: "policy",
      status: "queued",
      conversationId: root1.conversation_id,
      turnId: "550e8400-e29b-41d4-a716-446655440300",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ab",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d1a",
    });
    const getByIdSpy = vi.spyOn(ApprovalDal.prototype, "getById");

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({
        type: "transcript.get",
        payload: { conversation_key: root1.conversation_key },
      }),
      deps,
    )) as {
      ok: boolean;
      result: { events: Array<{ kind: string; event_id: string; conversation_key: string }> };
    };

    expect(response.ok).toBe(true);
    const approvalEvent = response.result.events.find(
      (event) => event.event_id === `approval:${approval.approval_id}`,
    );
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent).toMatchObject({
      kind: "approval",
      conversation_key: root1.conversation_key,
    });
    expect(getByIdSpy).not.toHaveBeenCalled();
  });
});

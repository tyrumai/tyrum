import { afterEach, describe, expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";
import { createConversationDalFixture } from "./conversation-dal.test-support.js";

describe("transcript WS handlers cycle protection", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("guards transcript.get against cyclic parent conversation links", async () => {
    const fixture = createConversationDalFixture();
    db = fixture.db;
    const firstSubagentId = "550e8400-e29b-41d4-a716-446655440001";
    const secondSubagentId = "550e8400-e29b-41d4-a716-446655440002";
    const child1 = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-child-1",
      containerKind: "group",
    });
    const child2 = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-child-2",
      containerKind: "group",
    });
    const child1ConversationKey = `agent:default:subagent:${firstSubagentId}`;
    const child2ConversationKey = `agent:default:subagent:${secondSubagentId}`;

    await db.run(
      "UPDATE conversations SET conversation_key = ? WHERE tenant_id = ? AND conversation_id = ?",
      [child1ConversationKey, child1.tenant_id, child1.conversation_id],
    );
    await db.run(
      "UPDATE conversations SET conversation_key = ? WHERE tenant_id = ? AND conversation_id = ?",
      [child2ConversationKey, child2.tenant_id, child2.conversation_id],
    );
    await insertSubagent({
      db,
      subagentId: firstSubagentId,
      tenantId: child1.tenant_id,
      agentId: child1.agent_id,
      workspaceId: child1.workspace_id,
      parentConversationKey: child2ConversationKey,
      conversationKey: child1ConversationKey,
      createdAt: "2026-02-17T00:00:30.000Z",
    });
    await insertSubagent({
      db,
      subagentId: secondSubagentId,
      tenantId: child2.tenant_id,
      agentId: child2.agent_id,
      workspaceId: child2.workspace_id,
      parentConversationKey: child1ConversationKey,
      conversationKey: child2ConversationKey,
      createdAt: "2026-02-17T00:00:40.000Z",
    });

    const response = (await handleClientMessage(
      createAdminWsClient(),
      serializeWsRequest({
        type: "transcript.get",
        payload: { conversation_key: child1ConversationKey },
      }),
      { connectionManager: new ConnectionManager(), db },
    )) as {
      ok: boolean;
      result: {
        root_conversation_key: string;
        focus_conversation_key: string;
        conversations: Array<{ conversation_key: string }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.root_conversation_key).toBe(child2ConversationKey);
    expect(response.result.focus_conversation_key).toBe(child1ConversationKey);
    expect(
      response.result.conversations.map((conversation) => conversation.conversation_key),
    ).toEqual([child2ConversationKey, child1ConversationKey]);
  });

  it("resolves cross-agent transcript lineage through intermediate subagent conversations", async () => {
    const fixture = createConversationDalFixture();
    db = fixture.db;
    const parentSubagentId = "550e8400-e29b-41d4-a716-446655440010";
    const childSubagentId = "550e8400-e29b-41d4-a716-446655440011";
    const root = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-root",
      containerKind: "group",
    });
    const parent = await fixture.dal.getOrCreate({
      scopeKeys: { agentKey: "reviewer" },
      connectorKey: "ui",
      providerThreadId: "thread-parent",
      containerKind: "group",
    });
    const child = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-child",
      containerKind: "group",
    });
    const parentConversationKey = `agent:reviewer:subagent:${parentSubagentId}`;
    const childConversationKey = `agent:default:subagent:${childSubagentId}`;

    await db.run(
      "UPDATE conversations SET conversation_key = ? WHERE tenant_id = ? AND conversation_id = ?",
      [parentConversationKey, parent.tenant_id, parent.conversation_id],
    );
    await db.run(
      "UPDATE conversations SET conversation_key = ? WHERE tenant_id = ? AND conversation_id = ?",
      [childConversationKey, child.tenant_id, child.conversation_id],
    );
    await insertSubagent({
      db,
      subagentId: parentSubagentId,
      tenantId: root.tenant_id,
      agentId: parent.agent_id,
      workspaceId: root.workspace_id,
      parentConversationKey: root.conversation_key,
      conversationKey: parentConversationKey,
      createdAt: "2026-02-17T00:00:30.000Z",
    });
    await insertSubagent({
      db,
      subagentId: childSubagentId,
      tenantId: root.tenant_id,
      agentId: child.agent_id,
      workspaceId: root.workspace_id,
      parentConversationKey: parentConversationKey,
      conversationKey: childConversationKey,
      createdAt: "2026-02-17T00:00:40.000Z",
    });

    const response = (await handleClientMessage(
      createAdminWsClient(),
      serializeWsRequest({
        type: "transcript.get",
        payload: { conversation_key: childConversationKey },
      }),
      { connectionManager: new ConnectionManager(), db },
    )) as {
      ok: boolean;
      result: {
        root_conversation_key: string;
        focus_conversation_key: string;
        conversations: Array<{ conversation_key: string }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.root_conversation_key).toBe(root.conversation_key);
    expect(response.result.focus_conversation_key).toBe(childConversationKey);
    expect(
      response.result.conversations.map((conversation) => conversation.conversation_key),
    ).toEqual([root.conversation_key, parentConversationKey, childConversationKey]);
  });
});

async function insertSubagent(input: {
  db: SqliteDb;
  subagentId: string;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  parentConversationKey: string;
  conversationKey: string;
  createdAt: string;
}): Promise<void> {
  await input.db.run(
    `INSERT INTO subagents (
       subagent_id,
       tenant_id,
       agent_id,
       workspace_id,
       parent_conversation_key,
       work_item_id,
       work_item_task_id,
       execution_profile,
       conversation_key,
       status,
       desktop_environment_id,
       attached_node_id,
       created_at,
       updated_at,
       last_heartbeat_at,
       closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.subagentId,
      input.tenantId,
      input.agentId,
      input.workspaceId,
      input.parentConversationKey,
      null,
      null,
      "executor",
      input.conversationKey,
      "running",
      null,
      null,
      input.createdAt,
      input.createdAt,
      null,
      null,
    ],
  );
}

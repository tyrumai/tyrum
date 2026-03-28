import { afterEach, describe, expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";
import {
  createConversationDalFixture,
  setConversationUpdatedAt,
} from "./conversation-dal.test-support.js";

describe("transcript WS active-only pagination", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function createTranscriptFixture() {
    const fixture = createConversationDalFixture();
    db = fixture.db;

    const root1 = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-root-1",
      containerKind: "group",
    });
    const root2 = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-root-2",
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

    return { root2 };
  }

  it("skips empty active_only pages until it finds a visible transcript", async () => {
    const { root2 } = await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    await db!.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_id,
         conversation_key,
         status,
         trigger_json,
         latest_turn_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        root2.tenant_id,
        "job-transcript-root2",
        root2.agent_id,
        root2.workspace_id,
        root2.conversation_id,
        root2.conversation_key,
        "running",
        "{}",
        "550e8400-e29b-41d4-a716-446655440300",
      ],
    );
    await db!.run(
      `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        root2.tenant_id,
        "550e8400-e29b-41d4-a716-446655440300",
        "job-transcript-root2",
        root2.conversation_key,
        "running",
        1,
        "2026-02-17T00:04:00.000Z",
      ],
    );

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({ type: "transcript.list", payload: { active_only: true, limit: 1 } }),
      deps,
    )) as {
      ok: boolean;
      result: { conversations: Array<{ conversation_key: string }>; next_cursor: string | null };
    };

    expect(response.ok).toBe(true);
    expect(
      response.result.conversations.map((conversation) => conversation.conversation_key),
    ).toEqual([root2.conversation_key]);
    expect(response.result.next_cursor).toBeNull();
  });

  it("stops scanning after a bounded number of empty active_only pages", async () => {
    const fixture = createConversationDalFixture();
    db = fixture.db;

    for (let index = 0; index < 12; index += 1) {
      const conversation = await fixture.dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: `thread-root-${String(index)}`,
        containerKind: "group",
      });
      const minute = String(59 - index).padStart(2, "0");
      await setConversationUpdatedAt({
        db: db!,
        tenantId: conversation.tenant_id,
        conversationIds: [conversation.conversation_id],
        valueSql: `'2026-02-17T00:${minute}:00.000Z'`,
      });
    }

    const response = (await handleClientMessage(
      createAdminWsClient(),
      serializeWsRequest({ type: "transcript.list", payload: { active_only: true, limit: 1 } }),
      { connectionManager: new ConnectionManager(), db: db! },
    )) as {
      ok: boolean;
      result: { conversations: Array<{ conversation_key: string }>; next_cursor: string | null };
    };

    expect(response.ok).toBe(true);
    expect(response.result.conversations).toEqual([]);
    expect(response.result.next_cursor).toEqual(expect.any(String));
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { buildScheduleConversationKey } from "../../src/modules/automation/conversation-routing.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";
import { createConversationDalFixture } from "./conversation-dal.test-support.js";
import { insertRunningExecutionTrace } from "./transcript-handlers.test-support.js";

describe("turn.list control-plane handler", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("returns conversation_key only for retained-conversation turns", async () => {
    const fixture = createConversationDalFixture();
    db = fixture.db;
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };
    const standaloneAutomationConversationKey = buildScheduleConversationKey({
      agentKey: "default",
      workspaceKey: "default",
      scheduleId: "daily-report",
    });

    const retainedConversation = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-retained",
      containerKind: "group",
    });

    await insertRunningExecutionTrace({
      db: db!,
      tenantId: retainedConversation.tenant_id,
      agentId: retainedConversation.agent_id,
      workspaceId: retainedConversation.workspace_id,
      conversationKey: retainedConversation.conversation_key,
      conversationId: retainedConversation.conversation_id,
      jobId: "550e8400-e29b-41d4-a716-446655440210",
      runId: "550e8400-e29b-41d4-a716-446655440211",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964aa",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d0f",
      createdAt: "2026-02-17T00:02:00.000Z",
    });

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
        retainedConversation.tenant_id,
        "550e8400-e29b-41d4-a716-446655440212",
        retainedConversation.agent_id,
        retainedConversation.workspace_id,
        null,
        standaloneAutomationConversationKey,
        "completed",
        "{}",
        "550e8400-e29b-41d4-a716-446655440213",
      ],
    );
    await db!.run(
      `INSERT INTO turns (
         tenant_id,
         turn_id,
         job_id,
         conversation_key,
         status,
         attempt,
         created_at,
         started_at,
         finished_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        retainedConversation.tenant_id,
        "550e8400-e29b-41d4-a716-446655440213",
        "550e8400-e29b-41d4-a716-446655440212",
        standaloneAutomationConversationKey,
        "succeeded",
        1,
        "2026-02-17T00:01:00.000Z",
        "2026-02-17T00:01:10.000Z",
        "2026-02-17T00:01:20.000Z",
      ],
    );

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({ type: "turn.list", payload: { limit: 10 } }),
      deps,
    )) as {
      ok: boolean;
      result: {
        turns: Array<{
          agent_key?: string;
          conversation_key?: string;
          turn: { turn_id: string; conversation_key: string };
        }>;
        steps: Array<{ turn_id: string }>;
        attempts: Array<{ step_id: string }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.turns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent_key: "default",
          conversation_key: retainedConversation.conversation_key,
          turn: expect.objectContaining({
            turn_id: "550e8400-e29b-41d4-a716-446655440211",
            conversation_key: retainedConversation.conversation_key,
          }),
        }),
        expect.objectContaining({
          agent_key: "default",
          turn: expect.objectContaining({
            turn_id: "550e8400-e29b-41d4-a716-446655440213",
            conversation_key: standaloneAutomationConversationKey,
          }),
        }),
      ]),
    );

    const standaloneTurn = response.result.turns.find(
      (item) => item.turn.turn_id === "550e8400-e29b-41d4-a716-446655440213",
    );
    expect(standaloneTurn?.conversation_key).toBeUndefined();
    expect(response.result.steps).toEqual([
      expect.objectContaining({ turn_id: "550e8400-e29b-41d4-a716-446655440211" }),
    ]);
    expect(response.result.attempts).toEqual([
      expect.objectContaining({ step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964aa" }),
    ]);
  });

  it("does not infer retained-conversation linkage from a matching run key alone", async () => {
    const fixture = createConversationDalFixture();
    db = fixture.db;
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    const existingConversation = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-existing",
      containerKind: "channel",
    });

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
        existingConversation.tenant_id,
        "550e8400-e29b-41d4-a716-446655440214",
        existingConversation.agent_id,
        existingConversation.workspace_id,
        null,
        existingConversation.conversation_key,
        "completed",
        "{}",
        "550e8400-e29b-41d4-a716-446655440215",
      ],
    );
    await db!.run(
      `INSERT INTO turns (
         tenant_id,
         turn_id,
         job_id,
         conversation_key,
         status,
         attempt,
         created_at,
         started_at,
         finished_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        existingConversation.tenant_id,
        "550e8400-e29b-41d4-a716-446655440215",
        "550e8400-e29b-41d4-a716-446655440214",
        existingConversation.conversation_key,
        "succeeded",
        1,
        "2026-02-17T00:03:00.000Z",
        "2026-02-17T00:03:10.000Z",
        "2026-02-17T00:03:20.000Z",
      ],
    );

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({ type: "turn.list", payload: { limit: 10 } }),
      deps,
    )) as {
      ok: boolean;
      result: {
        turns: Array<{
          conversation_key?: string;
          turn: { turn_id: string; conversation_key: string };
        }>;
      };
    };

    expect(response.ok).toBe(true);
    const matchingKeyTurn = response.result.turns.find(
      (item) => item.turn.turn_id === "550e8400-e29b-41d4-a716-446655440215",
    );
    expect(matchingKeyTurn?.turn.conversation_key).toBe(existingConversation.conversation_key);
    expect(matchingKeyTurn?.conversation_key).toBeUndefined();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";
import { createSessionDalFixture } from "./session-dal.test-support.js";
import { insertRunningExecutionTrace } from "./transcript-handlers.test-support.js";

describe("turn.list control-plane handler", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("returns conversation_key only for retained-session turns", async () => {
    const fixture = createSessionDalFixture();
    db = fixture.db;
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    const retainedSession = await fixture.dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-retained",
      containerKind: "group",
    });

    await insertRunningExecutionTrace({
      db: db!,
      tenantId: retainedSession.tenant_id,
      agentId: retainedSession.agent_id,
      workspaceId: retainedSession.workspace_id,
      sessionKey: retainedSession.session_key,
      sessionId: retainedSession.session_id,
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
         lane,
         status,
         trigger_json,
         latest_turn_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        retainedSession.tenant_id,
        "550e8400-e29b-41d4-a716-446655440212",
        retainedSession.agent_id,
        retainedSession.workspace_id,
        null,
        "cron:daily-report",
        "cron",
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
         lane,
         status,
         attempt,
         created_at,
         started_at,
         finished_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        retainedSession.tenant_id,
        "550e8400-e29b-41d4-a716-446655440213",
        "550e8400-e29b-41d4-a716-446655440212",
        "cron:daily-report",
        "cron",
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
          conversation_key: retainedSession.session_key,
          turn: expect.objectContaining({
            turn_id: "550e8400-e29b-41d4-a716-446655440211",
            conversation_key: retainedSession.session_key,
          }),
        }),
        expect.objectContaining({
          agent_key: "default",
          turn: expect.objectContaining({
            turn_id: "550e8400-e29b-41d4-a716-446655440213",
            conversation_key: "cron:daily-report",
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

  it("does not infer retained-session linkage from a matching run key alone", async () => {
    const fixture = createSessionDalFixture();
    db = fixture.db;
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    const existingSession = await fixture.dal.getOrCreate({
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
         lane,
         status,
         trigger_json,
         latest_turn_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        existingSession.tenant_id,
        "550e8400-e29b-41d4-a716-446655440214",
        existingSession.agent_id,
        existingSession.workspace_id,
        null,
        existingSession.session_key,
        "cron",
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
         lane,
         status,
         attempt,
         created_at,
         started_at,
         finished_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        existingSession.tenant_id,
        "550e8400-e29b-41d4-a716-446655440215",
        "550e8400-e29b-41d4-a716-446655440214",
        existingSession.session_key,
        "cron",
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
    expect(matchingKeyTurn?.turn.conversation_key).toBe(existingSession.session_key);
    expect(matchingKeyTurn?.conversation_key).toBeUndefined();
  });
});

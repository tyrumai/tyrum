import { afterEach, describe, expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";
import { createSessionDalFixture } from "./session-dal.test-support.js";
import { insertRunningExecutionTrace } from "./transcript-handlers.test-support.js";

describe("run.list control-plane handler", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("returns session_key only for retained-session runs", async () => {
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
      jobId: "550e8400-e29b-41d4-a716-446655440210",
      runId: "550e8400-e29b-41d4-a716-446655440211",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964aa",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d0f",
      createdAt: "2026-02-17T00:02:00.000Z",
    });

    await db!.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        retainedSession.tenant_id,
        "550e8400-e29b-41d4-a716-446655440212",
        retainedSession.agent_id,
        retainedSession.workspace_id,
        "cron:daily-report",
        "cron",
        "completed",
        "{}",
      ],
    );
    await db!.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt, created_at, started_at, finished_at)
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
      serializeWsRequest({ type: "run.list", payload: { limit: 10 } }),
      deps,
    )) as {
      ok: boolean;
      result: {
        runs: Array<{
          agent_key?: string;
          session_key?: string;
          run: { run_id: string; key: string; lane: string };
        }>;
        steps: Array<{ run_id: string }>;
        attempts: Array<{ step_id: string }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent_key: "default",
          session_key: retainedSession.session_key,
          run: expect.objectContaining({
            run_id: "550e8400-e29b-41d4-a716-446655440211",
            key: retainedSession.session_key,
            lane: "main",
          }),
        }),
        expect.objectContaining({
          agent_key: "default",
          run: expect.objectContaining({
            run_id: "550e8400-e29b-41d4-a716-446655440213",
            key: "cron:daily-report",
            lane: "cron",
          }),
        }),
      ]),
    );

    const standaloneRun = response.result.runs.find(
      (item) => item.run.run_id === "550e8400-e29b-41d4-a716-446655440213",
    );
    expect(standaloneRun?.session_key).toBeUndefined();
    expect(response.result.steps).toEqual([
      expect.objectContaining({ run_id: "550e8400-e29b-41d4-a716-446655440211" }),
    ]);
    expect(response.result.attempts).toEqual([
      expect.objectContaining({ step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964aa" }),
    ]);
  });
});

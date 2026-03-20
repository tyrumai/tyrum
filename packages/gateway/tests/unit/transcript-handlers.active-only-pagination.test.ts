import { afterEach, describe, expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";
import { createSessionDalFixture, setSessionUpdatedAt } from "./session-dal.test-support.js";

describe("transcript WS active-only pagination", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function createTranscriptFixture() {
    const fixture = createSessionDalFixture();
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

    await setSessionUpdatedAt({
      db: db!,
      tenantId: root1.tenant_id,
      sessionIds: [root1.session_id],
      valueSql: "'2026-02-17T00:03:00.000Z'",
    });
    await setSessionUpdatedAt({
      db: db!,
      tenantId: root2.tenant_id,
      sessionIds: [root2.session_id],
      valueSql: "'2026-02-17T00:02:00.000Z'",
    });

    return { root2 };
  }

  it("skips empty active_only pages until it finds a visible transcript", async () => {
    const { root2 } = await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    await db!.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        root2.tenant_id,
        "job-transcript-root2",
        root2.agent_id,
        root2.workspace_id,
        root2.session_key,
        "main",
        "running",
        "{}",
      ],
    );
    await db!.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        root2.tenant_id,
        "550e8400-e29b-41d4-a716-446655440300",
        "job-transcript-root2",
        root2.session_key,
        "main",
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
      result: { sessions: Array<{ session_key: string }>; next_cursor: string | null };
    };

    expect(response.ok).toBe(true);
    expect(response.result.sessions.map((session) => session.session_key)).toEqual([
      root2.session_key,
    ]);
    expect(response.result.next_cursor).toBeNull();
  });
});

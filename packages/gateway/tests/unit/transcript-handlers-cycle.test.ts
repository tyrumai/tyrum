import { afterEach, describe, expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";
import { createSessionDalFixture } from "./session-dal.test-support.js";

describe("transcript WS handlers cycle protection", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("guards transcript.get against cyclic parent session links", async () => {
    const fixture = createSessionDalFixture();
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
    const child1SessionKey = `agent:default:subagent:${firstSubagentId}`;
    const child2SessionKey = `agent:default:subagent:${secondSubagentId}`;

    await db.run("UPDATE sessions SET session_key = ? WHERE tenant_id = ? AND session_id = ?", [
      child1SessionKey,
      child1.tenant_id,
      child1.session_id,
    ]);
    await db.run("UPDATE sessions SET session_key = ? WHERE tenant_id = ? AND session_id = ?", [
      child2SessionKey,
      child2.tenant_id,
      child2.session_id,
    ]);
    await insertSubagent({
      db,
      subagentId: firstSubagentId,
      tenantId: child1.tenant_id,
      agentId: child1.agent_id,
      workspaceId: child1.workspace_id,
      parentSessionKey: child2SessionKey,
      sessionKey: child1SessionKey,
      createdAt: "2026-02-17T00:00:30.000Z",
    });
    await insertSubagent({
      db,
      subagentId: secondSubagentId,
      tenantId: child2.tenant_id,
      agentId: child2.agent_id,
      workspaceId: child2.workspace_id,
      parentSessionKey: child1SessionKey,
      sessionKey: child2SessionKey,
      createdAt: "2026-02-17T00:00:40.000Z",
    });

    const response = (await handleClientMessage(
      createAdminWsClient(),
      serializeWsRequest({
        type: "transcript.get",
        payload: { session_key: child1SessionKey },
      }),
      { connectionManager: new ConnectionManager(), db },
    )) as {
      ok: boolean;
      result: {
        root_session_key: string;
        focus_session_key: string;
        sessions: Array<{ session_key: string }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.root_session_key).toBe(child2SessionKey);
    expect(response.result.focus_session_key).toBe(child1SessionKey);
    expect(response.result.sessions.map((session) => session.session_key)).toEqual([
      child2SessionKey,
      child1SessionKey,
    ]);
  });
});

async function insertSubagent(input: {
  db: SqliteDb;
  subagentId: string;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  parentSessionKey: string;
  sessionKey: string;
  createdAt: string;
}): Promise<void> {
  await input.db.run(
    `INSERT INTO subagents (
       subagent_id,
       tenant_id,
       agent_id,
       workspace_id,
       parent_session_key,
       work_item_id,
       work_item_task_id,
       execution_profile,
       session_key,
       lane,
       status,
       desktop_environment_id,
       attached_node_id,
       created_at,
       updated_at,
       last_heartbeat_at,
       closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.subagentId,
      input.tenantId,
      input.agentId,
      input.workspaceId,
      input.parentSessionKey,
      null,
      null,
      "executor",
      input.sessionKey,
      "subagent",
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

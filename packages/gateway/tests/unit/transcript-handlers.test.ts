import { afterEach, describe, expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";
import { createSessionDalFixture, setSessionUpdatedAt } from "./session-dal.test-support.js";

describe("transcript WS handlers", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function createTranscriptFixture() {
    const fixture = createSessionDalFixture();
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
    const childSessionKey = `agent:default:subagent:${subagentId}`;
    await db!.run("UPDATE sessions SET session_key = ? WHERE tenant_id = ? AND session_id = ?", [
      childSessionKey,
      child1.tenant_id,
      child1.session_id,
    ]);
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

    await db!.run(
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
        subagentId,
        root1.tenant_id,
        root1.agent_id,
        root1.workspace_id,
        root1.session_key,
        null,
        null,
        "executor",
        childSessionKey,
        "subagent",
        "running",
        null,
        null,
        "2026-02-17T00:00:30.000Z",
        "2026-02-17T00:00:30.000Z",
        null,
        null,
      ],
    );

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
    await setSessionUpdatedAt({
      db: db!,
      tenantId: root3.tenant_id,
      sessionIds: [root3.session_id],
      valueSql: "'2026-02-17T00:01:00.000Z'",
    });

    return {
      dal: fixture.dal,
      root1,
      child1: { ...child1, session_key: childSessionKey },
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
        sessions: Array<{
          session_id: string;
          session_key: string;
          child_sessions?: Array<{ session_key: string }>;
        }>;
        next_cursor: string | null;
      };
    };

    expect(page1.ok).toBe(true);
    expect(page1.result.sessions.map((session) => session.session_key)).toEqual([
      root1.session_key,
      root2.session_key,
    ]);
    expect(page1.result.sessions[0]?.session_id).toBe(root1.session_id);
    expect(page1.result.sessions[0]?.child_sessions?.map((session) => session.session_key)).toEqual(
      [child1.session_key],
    );
    expect(
      page1.result.sessions.some((session) => session.session_key === otherTenant.session_key),
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
      result: { sessions: Array<{ session_key: string }>; next_cursor: string | null };
    };

    expect(page2.ok).toBe(true);
    expect(page2.result.sessions.map((session) => session.session_key)).toEqual([
      root3.session_key,
    ]);
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

    await db!.run("UPDATE sessions SET archived_at = ? WHERE tenant_id = ? AND session_id = ?", [
      "2026-02-18T00:00:00.000Z",
      root2.tenant_id,
      root2.session_id,
    ]);

    const activeResponse = (await handleClientMessage(
      client,
      serializeWsRequest({ type: "transcript.list", payload: { limit: 50 } }),
      deps,
    )) as {
      ok: boolean;
      result: { sessions: Array<{ session_key: string }> };
    };

    expect(activeResponse.ok).toBe(true);
    expect(activeResponse.result.sessions.map((session) => session.session_key)).toContain(
      root1.session_key,
    );
    expect(activeResponse.result.sessions.map((session) => session.session_key)).not.toContain(
      root2.session_key,
    );

    const archivedResponse = (await handleClientMessage(
      client,
      serializeWsRequest({
        type: "transcript.list",
        payload: { archived: true, limit: 50 },
      }),
      deps,
    )) as {
      ok: boolean;
      result: { sessions: Array<{ session_key: string; archived: boolean }> };
    };

    expect(archivedResponse.ok).toBe(true);
    expect(archivedResponse.result.sessions.map((session) => session.session_key)).toEqual([
      root2.session_key,
    ]);
    expect(archivedResponse.result.sessions[0]?.archived).toBe(true);
  });

  it("keeps a root transcript visible in active_only mode when a child session has an active run", async () => {
    const { child1, root1 } = await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    await db!.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        child1.tenant_id,
        "job-transcript-1",
        child1.agent_id,
        child1.workspace_id,
        child1.session_key,
        "main",
        "running",
        "{}",
      ],
    );
    await db!.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        child1.tenant_id,
        "550e8400-e29b-41d4-a716-446655440100",
        "job-transcript-1",
        child1.session_key,
        "main",
        "running",
        1,
        "2026-02-17T00:04:00.000Z",
      ],
    );

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({ type: "transcript.list", payload: { active_only: true, limit: 50 } }),
      deps,
    )) as {
      ok: boolean;
      result: {
        sessions: Array<{ session_key: string; child_sessions?: Array<{ session_key: string }> }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.sessions).toHaveLength(1);
    expect(response.result.sessions[0]?.session_key).toBe(root1.session_key);
    expect(response.result.sessions[0]?.child_sessions?.[0]?.session_key).toBe(child1.session_key);
  });

  it("resolves a child transcript to its root lineage and returns ordered events", async () => {
    const { dal, root1, child1, subagentId } = await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    await dal.replaceMessages({
      tenantId: root1.tenant_id,
      sessionId: root1.session_id,
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
      sessionId: child1.session_id,
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

    await db!.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        root1.tenant_id,
        "550e8400-e29b-41d4-a716-446655440201",
        root1.agent_id,
        root1.workspace_id,
        root1.session_key,
        "main",
        "running",
        "{}",
      ],
    );
    await db!.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        root1.tenant_id,
        "550e8400-e29b-41d4-a716-446655440200",
        "550e8400-e29b-41d4-a716-446655440201",
        root1.session_key,
        "main",
        "running",
        1,
        "2026-02-17T00:00:20.000Z",
      ],
    );
    await db!.run(
      `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        root1.tenant_id,
        "6f9619ff-8b86-4d11-b42d-00c04fc964aa",
        "550e8400-e29b-41d4-a716-446655440200",
        0,
        "running",
        JSON.stringify({ type: "Research", args: {} }),
        "2026-02-17T00:00:20.000Z",
      ],
    );
    await db!.run(
      `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        root1.tenant_id,
        "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d0f",
        "6f9619ff-8b86-4d11-b42d-00c04fc964aa",
        1,
        "running",
        "2026-02-17T00:00:20.000Z",
      ],
    );

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({
        type: "transcript.get",
        payload: { session_key: child1.session_key },
      }),
      deps,
    )) as {
      ok: boolean;
      result: {
        root_session_key: string;
        focus_session_key: string;
        sessions: Array<{ session_key: string }>;
        events: Array<{ kind: string; event_id: string }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.root_session_key).toBe(root1.session_key);
    expect(response.result.focus_session_key).toBe(child1.session_key);
    expect(response.result.sessions.map((session) => session.session_key)).toEqual([
      root1.session_key,
      child1.session_key,
    ]);
    expect(response.result.events.map((event) => event.kind)).toEqual([
      "message",
      "message",
      "run",
      "subagent",
    ]);
    const [firstMessageId, secondMessageId, runId, subagentEventId] = response.result.events.map(
      (event) => event.event_id,
    );
    expect([firstMessageId, secondMessageId]).toEqual(
      [
        `message:${root1.session_key}:root-msg`,
        `message:${child1.session_key}:child-msg`,
      ].toSorted(),
    );
    expect(runId).toBe("run:550e8400-e29b-41d4-a716-446655440200");
    expect(subagentEventId).toBe(`subagent:${subagentId}:spawned`);
  });

  it("includes approval events in transcript.get when approvals are linked to transcript runs", async () => {
    const { root1 } = await createTranscriptFixture();
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    await db!.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        root1.tenant_id,
        "550e8400-e29b-41d4-a716-446655440301",
        root1.agent_id,
        root1.workspace_id,
        root1.session_key,
        "main",
        "running",
        "{}",
      ],
    );
    await db!.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        root1.tenant_id,
        "550e8400-e29b-41d4-a716-446655440300",
        "550e8400-e29b-41d4-a716-446655440301",
        root1.session_key,
        "main",
        "running",
        1,
        "2026-02-17T00:00:20.000Z",
      ],
    );
    await db!.run(
      `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        root1.tenant_id,
        "6f9619ff-8b86-4d11-b42d-00c04fc964ab",
        "550e8400-e29b-41d4-a716-446655440300",
        0,
        "running",
        JSON.stringify({ type: "Research", args: {} }),
        "2026-02-17T00:00:20.000Z",
      ],
    );
    await db!.run(
      `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        root1.tenant_id,
        "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d1a",
        "6f9619ff-8b86-4d11-b42d-00c04fc964ab",
        1,
        "running",
        "2026-02-17T00:00:20.000Z",
      ],
    );

    const approval = await new ApprovalDal(db!).create({
      tenantId: root1.tenant_id,
      agentId: root1.agent_id,
      workspaceId: root1.workspace_id,
      approvalKey: "approval:transcript-run-1",
      prompt: "Approve transcript run?",
      motivation: "Approve transcript run?",
      kind: "policy",
      status: "queued",
      sessionId: root1.session_id,
      runId: "550e8400-e29b-41d4-a716-446655440300",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ab",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d1a",
    });

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({
        type: "transcript.get",
        payload: { session_key: root1.session_key },
      }),
      deps,
    )) as {
      ok: boolean;
      result: { events: Array<{ kind: string; event_id: string; session_key: string }> };
    };

    expect(response.ok).toBe(true);
    const approvalEvent = response.result.events.find(
      (event) => event.event_id === `approval:${approval.approval_id}`,
    );
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent).toMatchObject({
      kind: "approval",
      session_key: root1.session_key,
    });
  });
});

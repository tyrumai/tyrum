import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ChannelOutboxDal } from "../../src/modules/channels/outbox-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { seedCompletedTelegramTurn } from "../helpers/channel-session-repair.js";

describe("session command primitives", () => {
  let db: ReturnType<typeof openTestSqliteDb> | undefined;

  async function ensureSession(input: {
    agentKey: string;
    channel: string;
    accountKey?: string;
    threadId: string;
    containerKind: "dm" | "group" | "channel";
  }): Promise<Awaited<ReturnType<SessionDal["getOrCreate"]>>> {
    if (!db) throw new Error("db not initialized");
    const sessionDal = new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
    return await sessionDal.getOrCreate({
      scopeKeys: { agentKey: input.agentKey, workspaceKey: "default" },
      connectorKey: input.channel,
      accountKey: input.accountKey,
      providerThreadId: input.threadId,
      containerKind: input.containerKind,
    });
  }

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("supports /new", async () => {
    db = openTestSqliteDb();

    const result = await executeCommand("/new", {
      db,
      commandContext: { agentId: "default", channel: "ui:default", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({ channel: "ui" });

    const payload = result.data as {
      agent_id: string;
      channel: string;
      thread_id: string;
      session_id: string;
    };
    expect(payload.agent_id).toBe("default");
    expect(payload.thread_id).not.toBe("thread-1");
    expect(payload.thread_id).toMatch(/^ui-/);
    expect(payload.session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const stored = await db.get<{
      session_key: string;
      summary: string;
      turns_json: string;
    }>(
      `SELECT session_key, summary, turns_json
       FROM sessions
       WHERE tenant_id = ? AND session_id = ?`,
      [DEFAULT_TENANT_ID, payload.session_id],
    );
    expect(stored?.session_key).toMatch(/^agent:default:ui:/);
    expect(stored?.session_key).toContain(`:channel:${payload.thread_id}`);
    expect(stored?.summary).toBe("");
    expect(stored?.turns_json).toBe("[]");
  });

  it("supports /new for non-default channel accounts", async () => {
    db = openTestSqliteDb();

    const result = await executeCommand("/new", {
      db,
      commandContext: { agentId: "default", channel: "telegram:work" },
    });

    expect(result.data).toMatchObject({ channel: "telegram" });
    const payload = result.data as { session_id: string };

    const row = await db.get<{ account_key: string }>(
      `SELECT ca.account_key
       FROM sessions s
       JOIN channel_threads ct
         ON ct.tenant_id = s.tenant_id
        AND ct.channel_thread_id = s.channel_thread_id
       JOIN channel_accounts ca
         ON ca.tenant_id = ct.tenant_id
        AND ca.workspace_id = ct.workspace_id
        AND ca.channel_account_id = ct.channel_account_id
       WHERE s.tenant_id = ? AND s.session_id = ?`,
      [DEFAULT_TENANT_ID, payload.session_id],
    );
    expect(row?.account_key).toBe("work");
  });

  it("supports /compact (moves older turns into summary)", async () => {
    db = openTestSqliteDb();

    const nowIso = new Date().toISOString();
    const turns = Array.from({ length: 12 }, (_, idx) => ({
      role: idx % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg-${String(idx)}`,
      timestamp: `t-${String(idx)}`,
    }));

    const session = await ensureSession({
      agentKey: "default",
      channel: "ui",
      threadId: "thread-1",
      containerKind: "channel",
    });
    await db.run(
      `UPDATE sessions
       SET summary = ?, turns_json = ?, updated_at = ?
       WHERE tenant_id = ? AND session_id = ?`,
      ["prev-summary", JSON.stringify(turns), nowIso, session.tenant_id, session.session_id],
    );

    const result = await executeCommand("/compact", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({
      agent_id: "default",
      session_id: session.session_id,
      dropped_messages: 4,
      kept_messages: 8,
    });

    const updated = await db.get<{ summary: string; turns_json: string }>(
      `SELECT summary, turns_json
       FROM sessions
       WHERE tenant_id = ? AND session_id = ?`,
      [session.tenant_id, session.session_id],
    );
    expect(updated?.summary).toContain("prev-summary");
    expect(updated?.summary).toContain("msg-0");

    const parsed = updated?.turns_json
      ? (JSON.parse(updated.turns_json) as Array<{ content: string }>)
      : [];
    expect(parsed).toHaveLength(8);
    expect(parsed[0]?.content).toBe("msg-4");
    expect(parsed[7]?.content).toBe("msg-11");
  });

  it("supports /compact for non-default channel accounts", async () => {
    db = openTestSqliteDb();

    const nowIso = new Date().toISOString();
    const workTurns = Array.from({ length: 10 }, (_, idx) => ({
      role: idx % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `work-msg-${String(idx)}`,
      timestamp: `work-t-${String(idx)}`,
    }));
    const defaultTurns = [
      { role: "user" as const, content: "default-msg-0", timestamp: "default-t-0" },
      { role: "assistant" as const, content: "default-msg-1", timestamp: "default-t-1" },
    ];

    const defaultSession = await ensureSession({
      agentKey: "default",
      channel: "telegram",
      threadId: "thread-1",
      containerKind: "channel",
    });
    const workSession = await ensureSession({
      agentKey: "default",
      channel: "telegram",
      accountKey: "work",
      threadId: "thread-1",
      containerKind: "channel",
    });

    await db.run(
      `UPDATE sessions
       SET summary = ?, turns_json = ?, updated_at = ?
       WHERE tenant_id = ? AND session_id = ?`,
      [
        "default-summary",
        JSON.stringify(defaultTurns),
        nowIso,
        DEFAULT_TENANT_ID,
        defaultSession.session_id,
      ],
    );
    await db.run(
      `UPDATE sessions
       SET summary = ?, turns_json = ?, updated_at = ?
       WHERE tenant_id = ? AND session_id = ?`,
      [
        "work-summary",
        JSON.stringify(workTurns),
        nowIso,
        DEFAULT_TENANT_ID,
        workSession.session_id,
      ],
    );

    const result = await executeCommand("/compact", {
      db,
      commandContext: { agentId: "default", channel: "telegram:work", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({
      agent_id: "default",
      session_id: workSession.session_id,
      dropped_messages: 2,
      kept_messages: 8,
    });

    const workUpdated = await db.get<{ summary: string; turns_json: string }>(
      `SELECT summary, turns_json
       FROM sessions
       WHERE tenant_id = ? AND session_id = ?`,
      [DEFAULT_TENANT_ID, workSession.session_id],
    );
    expect(workUpdated?.summary).toContain("work-summary");
    expect(workUpdated?.summary).toContain("work-msg-0");
    const workParsed = workUpdated?.turns_json
      ? (JSON.parse(workUpdated.turns_json) as Array<{ content: string }>)
      : [];
    expect(workParsed).toHaveLength(8);
    expect(workParsed[0]?.content).toBe("work-msg-2");
    expect(workParsed[7]?.content).toBe("work-msg-9");

    const defaultUpdated = await db.get<{ summary: string; turns_json: string }>(
      `SELECT summary, turns_json
       FROM sessions
       WHERE tenant_id = ? AND session_id = ?`,
      [DEFAULT_TENANT_ID, defaultSession.session_id],
    );
    expect(defaultUpdated?.summary).toBe("default-summary");
    expect(defaultUpdated?.turns_json).toBe(JSON.stringify(defaultTurns));
  });

  it("supports /repair (rebuilds session context from retained channel logs)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-17T00:10:00.000Z"));
      db = openTestSqliteDb();

      const session = await ensureSession({
        agentKey: "default",
        channel: "telegram",
        threadId: "thread-repair",
        containerKind: "channel",
      });
      const inboxDal = new ChannelInboxDal(db);
      const outboxDal = new ChannelOutboxDal(db);

      await seedCompletedTelegramTurn({
        inboxDal,
        outboxDal,
        session,
        threadId: "thread-repair",
        messageId: "repair-1",
        userText: "user-one",
        assistantText: "assistant-one",
        receivedAtMs: Date.parse("2026-02-17T00:00:00.000Z"),
      });

      await db.run(
        `UPDATE sessions
         SET turns_json = ?, summary = ?, updated_at = ?
         WHERE tenant_id = ? AND session_id = ?`,
        ["[]", "stale-summary", "2026-02-17T00:00:01.000Z", DEFAULT_TENANT_ID, session.session_id],
      );

      const result = await executeCommand("/repair", {
        db,
        commandContext: { agentId: "default", channel: "telegram", threadId: "thread-repair" },
      });

      expect(result.data).toMatchObject({
        agent_id: "default",
        session_id: session.session_id,
        source_rows: 1,
        rebuilt_messages: 2,
        kept_messages: 2,
        dropped_messages: 0,
      });

      const updated = await db.get<{ summary: string; turns_json: string }>(
        `SELECT summary, turns_json
         FROM sessions
         WHERE tenant_id = ? AND session_id = ?`,
        [DEFAULT_TENANT_ID, session.session_id],
      );
      expect(updated?.summary).toBe("stale-summary");
      expect(updated?.turns_json).toContain("user-one");
      expect(updated?.turns_json).toContain("assistant-one");
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports /repair for dm sessions when the command is resolved from a dm key", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-17T00:10:00.000Z"));
      db = openTestSqliteDb();

      const session = await ensureSession({
        agentKey: "default",
        channel: "telegram",
        threadId: "dm-repair",
        containerKind: "dm",
      });
      const inboxDal = new ChannelInboxDal(db);
      const outboxDal = new ChannelOutboxDal(db);

      await seedCompletedTelegramTurn({
        inboxDal,
        outboxDal,
        session,
        threadId: "dm-repair",
        messageId: "repair-dm-1",
        userText: "dm-user",
        assistantText: "dm-assistant",
        receivedAtMs: Date.parse("2026-02-17T00:00:00.000Z"),
        threadKind: "private",
      });

      await db.run(
        `UPDATE sessions
         SET turns_json = ?, summary = ?
         WHERE tenant_id = ? AND session_id = ?`,
        ["[]", "", DEFAULT_TENANT_ID, session.session_id],
      );

      const result = await executeCommand("/repair", {
        db,
        commandContext: { agentId: "default", key: session.session_key },
      });

      expect(result.data).toMatchObject({
        agent_id: "default",
        session_id: session.session_id,
        source_rows: 1,
        rebuilt_messages: 2,
        kept_messages: 2,
        dropped_messages: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports /stop (cancels active run + clears queued inbox)", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:ui:default:channel:thread-1";
    const lane = "main";

    const session = await ensureSession({
      agentKey: "default",
      channel: "ui",
      threadId: "thread-1",
      containerKind: "channel",
    });

    await db.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
	       VALUES (?, ?, ?, ?, ?, ?, 'running', '{}')`,
      [DEFAULT_TENANT_ID, "job-1", DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID, key, lane],
    );
    await db.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
	       VALUES (?, ?, ?, ?, ?, 'running', 1)`,
      [DEFAULT_TENANT_ID, "run-1", "job-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
	       VALUES (?, ?, ?, 0, 'running', '{}')`,
      [DEFAULT_TENANT_ID, "step-1", "run-1"],
    );

    await db.run(
      `INSERT INTO channel_inbox (
         tenant_id,
         source,
         thread_id,
         message_id,
	         key,
	         lane,
	         received_at_ms,
	         payload_json,
	         status,
	         queue_mode,
	         workspace_id,
	         session_id,
	         channel_thread_id
	       ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'queued', 'collect', ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "ui",
        "thread-1",
        "msg-queued",
        key,
        lane,
        1_000,
        DEFAULT_WORKSPACE_ID,
        session.session_id,
        session.channel_thread_id,
      ],
    );
    await db.run(
      `INSERT INTO channel_inbox (
	         tenant_id,
	         source,
	         thread_id,
	         message_id,
	         key,
	         lane,
	         received_at_ms,
	         payload_json,
	         status,
	         queue_mode,
	         workspace_id,
	         session_id,
	         channel_thread_id
	       ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'completed', 'collect', ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "ui",
        "thread-1",
        "msg-done",
        key,
        lane,
        900,
        DEFAULT_WORKSPACE_ID,
        session.session_id,
        session.channel_thread_id,
      ],
    );

    const result = await executeCommand("/stop", {
      db,
      commandContext: { key, lane },
    });

    expect(result.data).toMatchObject({
      key,
      lane,
      cancelled_runs: 1,
      cleared_inbox: 1,
    });

    const run = await db.get<{ status: string }>(
      `SELECT status FROM execution_runs WHERE run_id = ?`,
      ["run-1"],
    );
    expect(run?.status).toBe("cancelled");

    const queued = await db.get<{ status: string; error: string | null }>(
      `SELECT status, error
       FROM channel_inbox
       WHERE message_id = ?`,
      ["msg-queued"],
    );
    expect(queued?.status).toBe("failed");
    expect(queued?.error).toContain("stop");

    const done = await db.get<{ status: string }>(
      `SELECT status FROM channel_inbox WHERE message_id = ?`,
      ["msg-done"],
    );
    expect(done?.status).toBe("completed");
  });

  it("supports /stop using channel/thread context (no key required)", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:ui:default:channel:thread-1";
    const lane = "main";

    await db.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
	       VALUES (?, ?, ?, ?, ?, ?, 'running', '{}')`,
      [DEFAULT_TENANT_ID, "job-ctx-1", DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID, key, lane],
    );
    await db.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
	       VALUES (?, ?, ?, ?, ?, 'running', 1)`,
      [DEFAULT_TENANT_ID, "run-ctx-1", "job-ctx-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
	       VALUES (?, ?, ?, 0, 'running', '{}')`,
      [DEFAULT_TENANT_ID, "step-ctx-1", "run-ctx-1"],
    );

    const result = await executeCommand("/stop", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({
      key,
      lane,
      cancelled_runs: 1,
      cleared_inbox: 0,
    });

    const run = await db.get<{ status: string }>(
      `SELECT status FROM execution_runs WHERE run_id = ?`,
      ["run-ctx-1"],
    );
    expect(run?.status).toBe("cancelled");
  });

  it("supports /stop fallback with dm execution keys", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";

    await db.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
	       VALUES (?, ?, ?, ?, ?, ?, 'running', '{}')`,
      [DEFAULT_TENANT_ID, "job-dm-1", DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID, key, lane],
    );
    await db.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
	       VALUES (?, ?, ?, ?, ?, 'running', 1)`,
      [DEFAULT_TENANT_ID, "run-dm-1", "job-dm-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
	       VALUES (?, ?, ?, 0, 'running', '{}')`,
      [DEFAULT_TENANT_ID, "step-dm-1", "run-dm-1"],
    );

    const result = await executeCommand("/stop", {
      db,
      commandContext: { agentId: "default", channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({
      key,
      lane,
      cancelled_runs: 1,
      cleared_inbox: 0,
    });

    const run = await db.get<{ status: string }>(
      `SELECT status FROM execution_runs WHERE run_id = ?`,
      ["run-dm-1"],
    );
    expect(run?.status).toBe("cancelled");
  });

  it("does not wildcard-match agent_id when resolving /stop fallback keys", async () => {
    db = openTestSqliteDb();

    const lane = "main";
    const otherAgentKey = "agent:agent-2:telegram:default:dm:chat-1";

    const otherAgentIds = await new IdentityScopeDal(db).resolveScopeIds({
      tenantKey: "default",
      agentKey: "agent-2",
      workspaceKey: "default",
    });

    await db.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
	       VALUES (?, ?, ?, ?, ?, ?, 'running', '{}')`,
      [
        otherAgentIds.tenantId,
        "job-agent-pattern-1",
        otherAgentIds.agentId,
        otherAgentIds.workspaceId,
        otherAgentKey,
        lane,
      ],
    );
    await db.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
	       VALUES (?, ?, ?, ?, ?, 'running', 1)`,
      [otherAgentIds.tenantId, "run-agent-pattern-1", "job-agent-pattern-1", otherAgentKey, lane],
    );
    await db.run(
      `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
	       VALUES (?, ?, ?, 0, 'running', '{}')`,
      [otherAgentIds.tenantId, "step-agent-pattern-1", "run-agent-pattern-1"],
    );

    const result = await executeCommand("/stop", {
      db,
      commandContext: { agentId: "agent_%", channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({
      cancelled_runs: 0,
      cleared_inbox: 0,
    });

    const run = await db.get<{ status: string }>(
      `SELECT status FROM execution_runs WHERE run_id = ?`,
      ["run-agent-pattern-1"],
    );
    expect(run?.status).toBe("running");
  });

  it("supports /reset (clears durable session state + overrides)", async () => {
    db = openTestSqliteDb();

    const nowIso = new Date().toISOString();
    const session = await ensureSession({
      agentKey: "default",
      channel: "ui",
      threadId: "thread-1",
      containerKind: "channel",
    });
    await db.run(
      `UPDATE sessions
	       SET summary = ?, turns_json = ?, updated_at = ?
	       WHERE tenant_id = ? AND session_id = ?`,
      [
        "to-reset",
        JSON.stringify([{ role: "user", content: "hi", timestamp: "t-1" }]),
        nowIso,
        session.tenant_id,
        session.session_id,
      ],
    );

    await db.run(
      `INSERT INTO session_model_overrides (tenant_id, session_id, model_id)
	       VALUES (?, ?, ?)`,
      [session.tenant_id, session.session_id, "openai/gpt-4.1"],
    );

    const authProfileId = randomUUID();
    await db.run(
      `INSERT INTO auth_profiles (
	         tenant_id,
	         auth_profile_id,
	         auth_profile_key,
	         provider_key,
	         type,
	         status,
	         labels_json,
	         created_at,
	         updated_at
	       ) VALUES (?, ?, ?, ?, 'api_key', 'active', '{}', ?, ?)`,
      [DEFAULT_TENANT_ID, authProfileId, "profile-openai-1", "openai", nowIso, nowIso],
    );

    await db.run(
      `INSERT INTO session_provider_pins (
	         tenant_id,
	         session_id,
	         provider_key,
	         auth_profile_id,
	         pinned_at
	       ) VALUES (?, ?, ?, ?, ?)`,
      [session.tenant_id, session.session_id, "openai", authProfileId, nowIso],
    );

    const key = "agent:default:ui:default:channel:thread-1";
    await db.run(
      `INSERT INTO lane_queue_mode_overrides (tenant_id, key, lane, queue_mode, updated_at_ms)
	       VALUES (?, ?, 'main', 'interrupt', ?)`,
      [DEFAULT_TENANT_ID, key, Date.now()],
    );
    await db.run(
      `INSERT INTO session_send_policy_overrides (tenant_id, key, send_policy, updated_at_ms)
	       VALUES (?, ?, 'off', ?)`,
      [DEFAULT_TENANT_ID, key, Date.now()],
    );

    const result = await executeCommand("/reset", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });
    expect(result.data).toMatchObject({
      agent_id: "default",
      session_id: session.session_id,
    });

    const resetSession = await db.get<{ summary: string; turns_json: string }>(
      `SELECT summary, turns_json
	       FROM sessions
	       WHERE tenant_id = ? AND session_id = ?`,
      [session.tenant_id, session.session_id],
    );
    expect(resetSession?.summary).toBe("");
    expect(resetSession?.turns_json).toBe("[]");

    const modelOverride = await db.get<{ model_id: string }>(
      `SELECT model_id
	       FROM session_model_overrides
	       WHERE tenant_id = ? AND session_id = ?`,
      [session.tenant_id, session.session_id],
    );
    expect(modelOverride).toBeUndefined();

    const pin = await db.get<{ auth_profile_id: string }>(
      `SELECT auth_profile_id
	       FROM session_provider_pins
	       WHERE tenant_id = ? AND session_id = ?`,
      [session.tenant_id, session.session_id],
    );
    expect(pin).toBeUndefined();

    const queueOverride = await db.get<{ queue_mode: string }>(
      `SELECT queue_mode
	       FROM lane_queue_mode_overrides
	       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [DEFAULT_TENANT_ID, key, "main"],
    );
    expect(queueOverride).toBeUndefined();

    const sendOverride = await db.get<{ send_policy: string }>(
      `SELECT send_policy
	       FROM session_send_policy_overrides
	       WHERE tenant_id = ? AND key = ?`,
      [DEFAULT_TENANT_ID, key],
    );
    expect(sendOverride).toBeUndefined();
  });

  it("supports /reset fallback with dm execution keys", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";
    const nowIso = new Date().toISOString();

    const session = await ensureSession({
      agentKey: "default",
      channel: "telegram",
      threadId: "chat-1",
      containerKind: "dm",
    });
    await db.run(
      `UPDATE sessions
	       SET summary = ?, turns_json = ?, updated_at = ?
	       WHERE tenant_id = ? AND session_id = ?`,
      [
        "to-reset",
        JSON.stringify([{ role: "user", content: "hi", timestamp: "t-1" }]),
        nowIso,
        session.tenant_id,
        session.session_id,
      ],
    );

    await db.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
	       VALUES (?, ?, ?, ?, ?, ?, 'running', '{}')`,
      [DEFAULT_TENANT_ID, "job-reset-dm-1", DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID, key, lane],
    );
    await db.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
	       VALUES (?, ?, ?, ?, ?, 'running', 1)`,
      [DEFAULT_TENANT_ID, "run-reset-dm-1", "job-reset-dm-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
	       VALUES (?, ?, ?, 0, 'running', '{}')`,
      [DEFAULT_TENANT_ID, "step-reset-dm-1", "run-reset-dm-1"],
    );
    await db.run(
      `INSERT INTO channel_inbox (
	         tenant_id,
	         source,
	         thread_id,
	         message_id,
	         key,
	         lane,
	         received_at_ms,
	         payload_json,
	         status,
	         queue_mode,
	         workspace_id,
	         session_id,
	         channel_thread_id
	       ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'queued', 'collect', ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "telegram:default",
        "chat-1",
        "msg-reset-queued",
        key,
        lane,
        1_000,
        DEFAULT_WORKSPACE_ID,
        session.session_id,
        session.channel_thread_id,
      ],
    );

    await db.run(
      `INSERT INTO lane_queue_mode_overrides (tenant_id, key, lane, queue_mode, updated_at_ms)
	       VALUES (?, ?, ?, 'interrupt', ?)`,
      [DEFAULT_TENANT_ID, key, lane, Date.now()],
    );
    await db.run(
      `INSERT INTO session_send_policy_overrides (tenant_id, key, send_policy, updated_at_ms)
	       VALUES (?, ?, 'off', ?)`,
      [DEFAULT_TENANT_ID, key, Date.now()],
    );

    const result = await executeCommand("/reset", {
      db,
      commandContext: { agentId: "default", channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({
      agent_id: "default",
      session_id: session.session_id,
    });

    const run = await db.get<{ status: string }>(
      `SELECT status FROM execution_runs WHERE run_id = ?`,
      ["run-reset-dm-1"],
    );
    expect(run?.status).toBe("cancelled");

    const queued = await db.get<{ status: string; error: string | null }>(
      `SELECT status, error
       FROM channel_inbox
       WHERE message_id = ?`,
      ["msg-reset-queued"],
    );
    expect(queued?.status).toBe("failed");
    expect(queued?.error).toContain("reset");

    const queueOverride = await db.get<{ queue_mode: string }>(
      `SELECT queue_mode
	       FROM lane_queue_mode_overrides
	       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [DEFAULT_TENANT_ID, key, lane],
    );
    expect(queueOverride).toBeUndefined();

    const sendOverride = await db.get<{ send_policy: string }>(
      `SELECT send_policy
	       FROM session_send_policy_overrides
	       WHERE tenant_id = ? AND key = ?`,
      [DEFAULT_TENANT_ID, key],
    );
    expect(sendOverride).toBeUndefined();
  });

  it("supports /reset for non-default channel accounts", async () => {
    db = openTestSqliteDb();

    const nowIso = new Date().toISOString();

    const defaultSession = await ensureSession({
      agentKey: "default",
      channel: "telegram",
      threadId: "thread-1",
      containerKind: "channel",
    });
    const workSession = await ensureSession({
      agentKey: "default",
      channel: "telegram",
      accountKey: "work",
      threadId: "thread-1",
      containerKind: "channel",
    });

    const defaultTurns = [{ role: "user", content: "default-hi", timestamp: "default-t-1" }];
    const workTurns = [{ role: "user", content: "work-hi", timestamp: "work-t-1" }];

    await db.run(
      `UPDATE sessions
       SET summary = ?, turns_json = ?, updated_at = ?
       WHERE tenant_id = ? AND session_id = ?`,
      [
        "default-to-keep",
        JSON.stringify(defaultTurns),
        nowIso,
        DEFAULT_TENANT_ID,
        defaultSession.session_id,
      ],
    );
    await db.run(
      `UPDATE sessions
       SET summary = ?, turns_json = ?, updated_at = ?
       WHERE tenant_id = ? AND session_id = ?`,
      [
        "work-to-reset",
        JSON.stringify(workTurns),
        nowIso,
        DEFAULT_TENANT_ID,
        workSession.session_id,
      ],
    );

    const result = await executeCommand("/reset", {
      db,
      commandContext: { agentId: "default", channel: "telegram:work", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({
      agent_id: "default",
      session_id: workSession.session_id,
    });

    const resetSession = await db.get<{ summary: string; turns_json: string }>(
      `SELECT summary, turns_json
       FROM sessions
       WHERE tenant_id = ? AND session_id = ?`,
      [DEFAULT_TENANT_ID, workSession.session_id],
    );
    expect(resetSession?.summary).toBe("");
    expect(resetSession?.turns_json).toBe("[]");

    const defaultUnchanged = await db.get<{ summary: string; turns_json: string }>(
      `SELECT summary, turns_json
       FROM sessions
       WHERE tenant_id = ? AND session_id = ?`,
      [DEFAULT_TENANT_ID, defaultSession.session_id],
    );
    expect(defaultUnchanged?.summary).toBe("default-to-keep");
    expect(defaultUnchanged?.turns_json).toBe(JSON.stringify(defaultTurns));
  });
});

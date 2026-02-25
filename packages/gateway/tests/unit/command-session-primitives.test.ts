import { afterEach, describe, expect, it } from "vitest";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("session command primitives", () => {
  let db: ReturnType<typeof openTestSqliteDb> | undefined;

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
    expect(payload.session_id).toContain("ui:");

    const stored = await db.get<{ channel: string; thread_id: string; summary: string; turns_json: string }>(
      `SELECT channel, thread_id, summary, turns_json
       FROM sessions
       WHERE agent_id = ? AND session_id = ?`,
      ["default", payload.session_id],
    );
    expect(stored?.channel).toBe("ui");
    expect(stored?.thread_id).toBe(payload.thread_id);
    expect(stored?.summary).toBe("");
    expect(stored?.turns_json).toBe("[]");
  });

  it("supports /compact (moves older turns into summary)", async () => {
    db = openTestSqliteDb();

    const nowIso = new Date().toISOString();
    const turns = Array.from({ length: 12 }, (_, idx) => ({
      role: idx % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg-${String(idx)}`,
      timestamp: `t-${String(idx)}`,
    }));

    await db.run(
      `INSERT INTO sessions (
         agent_id,
         session_id,
         channel,
         thread_id,
         summary,
         turns_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["default", "ui:thread-1", "ui", "thread-1", "prev-summary", JSON.stringify(turns), nowIso, nowIso],
    );

    const result = await executeCommand("/compact", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({
      agent_id: "default",
      session_id: "ui:thread-1",
      dropped_messages: 4,
      kept_messages: 8,
    });

    const updated = await db.get<{ summary: string; turns_json: string }>(
      `SELECT summary, turns_json
       FROM sessions
       WHERE agent_id = ? AND session_id = ?`,
      ["default", "ui:thread-1"],
    );
    expect(updated?.summary).toContain("prev-summary");
    expect(updated?.summary).toContain("msg-0");

    const parsed = updated?.turns_json ? (JSON.parse(updated.turns_json) as Array<{ content: string }>) : [];
    expect(parsed).toHaveLength(8);
    expect(parsed[0]?.content).toBe("msg-4");
    expect(parsed[7]?.content).toBe("msg-11");
  });

  it("supports /stop (cancels active run + clears queued inbox)", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:ui:default:channel:thread-1";
    const lane = "main";

    await db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, 'running', '{}')`,
      ["job-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, 'running', 1)`,
      ["run-1", "job-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, 0, 'running', '{}')`,
      ["step-1", "run-1"],
    );

    await db.run(
      `INSERT INTO channel_inbox (
         source,
         thread_id,
         message_id,
         key,
         lane,
         received_at_ms,
         payload_json,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, '{}', 'queued')`,
      ["ui", "thread-1", "msg-queued", key, lane, 1_000],
    );
    await db.run(
      `INSERT INTO channel_inbox (
         source,
         thread_id,
         message_id,
         key,
         lane,
         received_at_ms,
         payload_json,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, '{}', 'completed')`,
      ["ui", "thread-1", "msg-done", key, lane, 900],
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
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, 'running', '{}')`,
      ["job-ctx-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, 'running', 1)`,
      ["run-ctx-1", "job-ctx-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, 0, 'running', '{}')`,
      ["step-ctx-1", "run-ctx-1"],
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
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, 'running', '{}')`,
      ["job-dm-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, 'running', 1)`,
      ["run-dm-1", "job-dm-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, 0, 'running', '{}')`,
      ["step-dm-1", "run-dm-1"],
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

    await db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, 'running', '{}')`,
      ["job-agent-pattern-1", otherAgentKey, lane],
    );
    await db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, 'running', 1)`,
      ["run-agent-pattern-1", "job-agent-pattern-1", otherAgentKey, lane],
    );
    await db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, 0, 'running', '{}')`,
      ["step-agent-pattern-1", "run-agent-pattern-1"],
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
    await db.run(
      `INSERT INTO sessions (
         agent_id,
         session_id,
         channel,
         thread_id,
         summary,
         turns_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "default",
        "ui:thread-1",
        "ui",
        "thread-1",
        "to-reset",
        JSON.stringify([{ role: "user", content: "hi", timestamp: "t-1" }]),
        nowIso,
        nowIso,
      ],
    );

    await db.run(
      `INSERT INTO session_model_overrides (agent_id, session_id, model_id, updated_at)
       VALUES (?, ?, ?, ?)`,
      ["default", "ui:thread-1", "openai/gpt-4.1", nowIso],
    );

    await db.run(
      `INSERT INTO auth_profiles (
         profile_id,
         agent_id,
         provider,
         type,
         secret_handles_json,
         status,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, 'api_key', ?, 'active', ?, ?)`,
      [
        "profile-openai-1",
        "default",
        "openai",
        JSON.stringify({ api_key_handle: "handle-openai-1" }),
        nowIso,
        nowIso,
      ],
    );

    await db.run(
      `INSERT INTO session_provider_pins (agent_id, session_id, provider, profile_id, pinned_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["default", "ui:thread-1", "openai", "profile-openai-1", nowIso, nowIso],
    );

    const key = "agent:default:ui:default:channel:thread-1";
    await db.run(
      `INSERT INTO lane_queue_mode_overrides (key, lane, queue_mode, updated_at_ms)
       VALUES (?, 'main', 'interrupt', ?)`,
      [key, Date.now()],
    );
    await db.run(
      `INSERT INTO session_send_policy_overrides (key, send_policy, updated_at_ms)
       VALUES (?, 'off', ?)`,
      [key, Date.now()],
    );

    const result = await executeCommand("/reset", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });
    expect(result.data).toMatchObject({
      agent_id: "default",
      session_id: "ui:thread-1",
    });

    const session = await db.get<{ summary: string; turns_json: string }>(
      `SELECT summary, turns_json
       FROM sessions
       WHERE agent_id = ? AND session_id = ?`,
      ["default", "ui:thread-1"],
    );
    expect(session?.summary).toBe("");
    expect(session?.turns_json).toBe("[]");

    const modelOverride = await db.get<{ model_id: string }>(
      `SELECT model_id
       FROM session_model_overrides
       WHERE agent_id = ? AND session_id = ?`,
      ["default", "ui:thread-1"],
    );
    expect(modelOverride).toBeUndefined();

    const pin = await db.get<{ profile_id: string }>(
      `SELECT profile_id
       FROM session_provider_pins
       WHERE agent_id = ? AND session_id = ?`,
      ["default", "ui:thread-1"],
    );
    expect(pin).toBeUndefined();

    const queueOverride = await db.get<{ queue_mode: string }>(
      `SELECT queue_mode
       FROM lane_queue_mode_overrides
       WHERE key = ? AND lane = ?`,
      [key, "main"],
    );
    expect(queueOverride).toBeUndefined();

    const sendOverride = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM session_send_policy_overrides
       WHERE key = ?`,
      [key],
    );
    expect(sendOverride).toBeUndefined();
  });

  it("supports /reset fallback with dm execution keys", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";
    const nowIso = new Date().toISOString();

    await db.run(
      `INSERT INTO sessions (
         agent_id,
         session_id,
         channel,
         thread_id,
         summary,
         turns_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "default",
        "telegram:chat-1",
        "telegram",
        "chat-1",
        "to-reset",
        JSON.stringify([{ role: "user", content: "hi", timestamp: "t-1" }]),
        nowIso,
        nowIso,
      ],
    );

    await db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, 'running', '{}')`,
      ["job-reset-dm-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, 'running', 1)`,
      ["run-reset-dm-1", "job-reset-dm-1", key, lane],
    );
    await db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, 0, 'running', '{}')`,
      ["step-reset-dm-1", "run-reset-dm-1"],
    );
    await db.run(
      `INSERT INTO channel_inbox (
         source,
         thread_id,
         message_id,
         key,
         lane,
         received_at_ms,
         payload_json,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, '{}', 'queued')`,
      ["telegram", "chat-1", "msg-reset-queued", key, lane, 1_000],
    );

    await db.run(
      `INSERT INTO lane_queue_mode_overrides (key, lane, queue_mode, updated_at_ms)
       VALUES (?, ?, 'interrupt', ?)`,
      [key, lane, Date.now()],
    );
    await db.run(
      `INSERT INTO session_send_policy_overrides (key, send_policy, updated_at_ms)
       VALUES (?, 'off', ?)`,
      [key, Date.now()],
    );

    const result = await executeCommand("/reset", {
      db,
      commandContext: { agentId: "default", channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({
      agent_id: "default",
      session_id: "telegram:chat-1",
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
       WHERE key = ? AND lane = ?`,
      [key, lane],
    );
    expect(queueOverride).toBeUndefined();

    const sendOverride = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM session_send_policy_overrides
       WHERE key = ?`,
      [key],
    );
    expect(sendOverride).toBeUndefined();
  });
});

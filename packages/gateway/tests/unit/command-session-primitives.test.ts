import { afterEach, describe, expect, it } from "vitest";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import * as support from "./command-session-primitives.test-support.js";

describe("session command primitives", () => {
  let db: ReturnType<typeof openTestSqliteDb> | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createCompactAgentsStub() {
    return {
      getRuntime: async () => ({
        compactSession: async (input: { sessionId: string }) => {
          if (!db) {
            throw new Error("missing db");
          }
          const snapshot = await support.readSessionSnapshot(db, input.sessionId);
          const turns = JSON.parse(snapshot.turnsJson) as Array<{
            role: "user" | "assistant";
            content: string;
            timestamp: string;
          }>;
          const keepLastMessages = 8;
          const dropped = Math.max(0, turns.length - keepLastMessages);
          const keptTurns = keepLastMessages > 0 ? turns.slice(-keepLastMessages) : [];
          const summaryLines = turns
            .slice(0, dropped)
            .map((turn) => `${turn.role} ${turn.timestamp}: ${turn.content}`);
          const summary = [snapshot.summary, ...summaryLines]
            .filter((value) => value.length > 0)
            .join("\n");
          await support.writeSessionState(
            db,
            {
              session_id: input.sessionId,
              tenant_id: DEFAULT_TENANT_ID,
            },
            {
              summary,
              turns: keptTurns,
            },
          );
          return {
            compacted: dropped > 0,
            droppedMessages: dropped,
            keptMessages: keptTurns.length,
            summary,
            reason: "model" as const,
          };
        },
      }),
    };
  }

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

    const stored = await support.readSessionRecord(db, payload.session_id);
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
    expect((await support.readSessionAccountKey(db, payload.session_id))?.account_key).toBe("work");
  });

  it("supports /compact (moves older turns into summary)", async () => {
    db = openTestSqliteDb();

    const session = await support.ensureSession(db, {
      agentKey: "default",
      channel: "ui",
      threadId: "thread-1",
      containerKind: "channel",
    });
    await support.writeSessionState(db, session, {
      summary: "prev-summary",
      turns: support.buildTurns(12, "msg-", "t-"),
    });

    const result = await executeCommand("/compact", {
      db,
      agents: createCompactAgentsStub() as never,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({
      agent_id: "default",
      session_id: session.session_id,
      dropped_messages: 4,
      kept_messages: 8,
    });

    const snapshot = await support.readSessionSnapshot(db, session.session_id, session.tenant_id);
    expect(snapshot.summary).toContain("prev-summary");
    expect(snapshot.summary).toContain("msg-0");
    expect(snapshot.turnContents).toHaveLength(8);
    expect(snapshot.turnContents[0]).toBe("msg-4");
    expect(snapshot.turnContents[7]).toBe("msg-11");
  });

  it("supports /compact for non-default channel accounts", async () => {
    db = openTestSqliteDb();

    const defaultSession = await support.ensureSession(db, {
      agentKey: "default",
      channel: "telegram",
      threadId: "thread-1",
      containerKind: "channel",
    });
    const workSession = await support.ensureSession(db, {
      agentKey: "default",
      channel: "telegram",
      accountKey: "work",
      threadId: "thread-1",
      containerKind: "channel",
    });

    await support.writeSessionState(db, defaultSession, {
      summary: "default-summary",
      turns: support.buildTurns(2, "default-msg-", "default-t-"),
    });
    await support.writeSessionState(db, workSession, {
      summary: "work-summary",
      turns: support.buildTurns(10, "work-msg-", "work-t-"),
    });

    const result = await executeCommand("/compact", {
      db,
      agents: createCompactAgentsStub() as never,
      commandContext: { agentId: "default", channel: "telegram:work", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({
      agent_id: "default",
      session_id: workSession.session_id,
      dropped_messages: 2,
      kept_messages: 8,
    });

    const workSnapshot = await support.readSessionSnapshot(db, workSession.session_id);
    expect(workSnapshot.summary).toContain("work-summary");
    expect(workSnapshot.summary).toContain("work-msg-0");
    expect(workSnapshot.turnContents).toHaveLength(8);
    expect(workSnapshot.turnContents[0]).toBe("work-msg-2");
    expect(workSnapshot.turnContents[7]).toBe("work-msg-9");

    const defaultSnapshot = await support.readSessionSnapshot(db, defaultSession.session_id);
    expect(defaultSnapshot.summary).toBe("default-summary");
    expect(defaultSnapshot.turnsJson).toBe(
      JSON.stringify(support.buildTurns(2, "default-msg-", "default-t-")),
    );
  });

  it("supports /repair (rebuilds session context from retained channel logs)", async () => {
    await support.withFakeSystemTime("2026-02-17T00:10:00.000Z", async () => {
      db = openTestSqliteDb();

      const session = await support.ensureSession(db, {
        agentKey: "default",
        channel: "telegram",
        threadId: "thread-repair",
        containerKind: "channel",
      });
      await support.seedTelegramRepairTurn(db, {
        session,
        threadId: "thread-repair",
        messageId: "repair-1",
        userText: "user-one",
        assistantText: "assistant-one",
        receivedAtMs: Date.parse("2026-02-17T00:00:00.000Z"),
      });
      await support.writeSessionState(db, session, {
        summary: "stale-summary",
        turns: [],
        updatedAt: "2026-02-17T00:00:01.000Z",
      });

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

      const snapshot = await support.readSessionSnapshot(db, session.session_id);
      expect(snapshot.summary).toBe("");
      expect(snapshot.turnContents).toEqual(["user-one", "assistant-one"]);
    });
  });

  it("supports /repair for dm sessions when the command is resolved from a dm key", async () => {
    await support.withFakeSystemTime("2026-02-17T00:10:00.000Z", async () => {
      db = openTestSqliteDb();

      const session = await support.ensureSession(db, {
        agentKey: "default",
        channel: "telegram",
        threadId: "dm-repair",
        containerKind: "dm",
      });
      await support.seedTelegramRepairTurn(db, {
        session,
        threadId: "dm-repair",
        messageId: "repair-dm-1",
        userText: "dm-user",
        assistantText: "dm-assistant",
        receivedAtMs: Date.parse("2026-02-17T00:00:00.000Z"),
        threadKind: "private",
      });
      await support.writeSessionState(db, session, { summary: "", turns: [] });

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
    });
  });

  it("supports /stop (cancels active run + clears queued inbox)", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:ui:default:channel:thread-1";
    const lane = "main";
    const session = await support.ensureSession(db, {
      agentKey: "default",
      channel: "ui",
      threadId: "thread-1",
      containerKind: "channel",
    });

    await support.seedRunningExecution(db, {
      key,
      lane,
      jobId: "job-1",
      runId: "run-1",
      stepId: "step-1",
    });
    await support.seedInboxMessage(db, {
      source: "ui",
      threadId: "thread-1",
      messageId: "msg-queued",
      key,
      lane,
      status: "queued",
      session,
    });
    await support.seedInboxMessage(db, {
      source: "ui",
      threadId: "thread-1",
      messageId: "msg-done",
      key,
      lane,
      status: "completed",
      session,
      receivedAtMs: 900,
    });

    const result = await executeCommand("/stop", { db, commandContext: { key, lane } });

    expect(result.data).toMatchObject({ key, lane, cancelled_runs: 1, cleared_inbox: 1 });
    expect(await support.readRunStatus(db, "run-1")).toBe("cancelled");

    const queued = await support.readInboxStatus(db, "msg-queued");
    expect(queued?.status).toBe("failed");
    expect(queued?.error).toContain("stop");
    expect((await support.readInboxStatus(db, "msg-done"))?.status).toBe("completed");
  });

  it("supports /stop using channel/thread context (no key required)", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:ui:default:channel:thread-1";
    await support.seedRunningExecution(db, {
      key,
      lane: "main",
      jobId: "job-ctx-1",
      runId: "run-ctx-1",
      stepId: "step-ctx-1",
    });

    const result = await executeCommand("/stop", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({ key, lane: "main", cancelled_runs: 1, cleared_inbox: 0 });
    expect(await support.readRunStatus(db, "run-ctx-1")).toBe("cancelled");
  });

  it("supports /stop fallback with dm execution keys", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:telegram:default:dm:chat-1";
    await support.seedRunningExecution(db, {
      key,
      lane: "main",
      jobId: "job-dm-1",
      runId: "run-dm-1",
      stepId: "step-dm-1",
    });

    const result = await executeCommand("/stop", {
      db,
      commandContext: { agentId: "default", channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({ key, lane: "main", cancelled_runs: 1, cleared_inbox: 0 });
    expect(await support.readRunStatus(db, "run-dm-1")).toBe("cancelled");
  });

  it("does not wildcard-match agent_id when resolving /stop fallback keys", async () => {
    db = openTestSqliteDb();

    const otherAgentIds = await new (
      await import("../../src/modules/identity/scope.js")
    ).IdentityScopeDal(db).resolveScopeIds({
      tenantKey: "default",
      agentKey: "agent-2",
      workspaceKey: "default",
    });
    await support.seedRunningExecution(db, {
      key: "agent:agent-2:telegram:default:dm:chat-1",
      lane: "main",
      jobId: "job-agent-pattern-1",
      runId: "run-agent-pattern-1",
      stepId: "step-agent-pattern-1",
      tenantId: otherAgentIds.tenantId,
      agentId: otherAgentIds.agentId,
      workspaceId: otherAgentIds.workspaceId,
    });

    const result = await executeCommand("/stop", {
      db,
      commandContext: { agentId: "agent_%", channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({ cancelled_runs: 0, cleared_inbox: 0 });
    expect(await support.readRunStatus(db, "run-agent-pattern-1")).toBe("running");
  });

  it("supports /reset (clears durable session state + overrides)", async () => {
    db = openTestSqliteDb();

    const session = await support.ensureSession(db, {
      agentKey: "default",
      channel: "ui",
      threadId: "thread-1",
      containerKind: "channel",
    });
    await support.writeSessionState(db, session, {
      summary: "to-reset",
      turns: [{ role: "user", content: "hi", timestamp: "t-1" }],
    });

    await db.run(
      `INSERT INTO session_model_overrides (tenant_id, session_id, model_id) VALUES (?, ?, ?)`,
      [session.tenant_id, session.session_id, "openai/gpt-4.1"],
    );
    const authProfileId = await support.seedAuthProfile(db, {
      authProfileKey: "profile-openai-1",
      providerKey: "openai",
    });
    await support.seedSessionProviderPin(db, {
      sessionId: session.session_id,
      providerKey: "openai",
      authProfileId,
    });

    const key = "agent:default:ui:default:channel:thread-1";
    await support.writeLaneQueueOverride(db, { key });
    await support.writeSendPolicyOverride(db, { key });

    const result = await executeCommand("/reset", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({ agent_id: "default", session_id: session.session_id });
    expect(
      await support.readSessionSnapshot(db, session.session_id, session.tenant_id),
    ).toMatchObject({
      summary: "",
      turnsJson: "[]",
    });
    expect(
      await db.get(
        `SELECT model_id FROM session_model_overrides WHERE tenant_id = ? AND session_id = ?`,
        [session.tenant_id, session.session_id],
      ),
    ).toBeUndefined();
    expect(
      await db.get(
        `SELECT auth_profile_id FROM session_provider_pins WHERE tenant_id = ? AND session_id = ?`,
        [session.tenant_id, session.session_id],
      ),
    ).toBeUndefined();
    expect(await support.readLaneQueueOverride(db, key)).toBeUndefined();
    expect(await support.readSendPolicyOverride(db, key)).toBeUndefined();
  });

  it("supports /reset fallback with dm execution keys", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:telegram:default:dm:chat-1";
    const session = await support.ensureSession(db, {
      agentKey: "default",
      channel: "telegram",
      threadId: "chat-1",
      containerKind: "dm",
    });
    await support.writeSessionState(db, session, {
      summary: "to-reset",
      turns: [{ role: "user", content: "hi", timestamp: "t-1" }],
    });

    await support.seedRunningExecution(db, {
      key,
      lane: "main",
      jobId: "job-reset-dm-1",
      runId: "run-reset-dm-1",
      stepId: "step-reset-dm-1",
    });
    await support.seedInboxMessage(db, {
      source: "telegram:default",
      threadId: "chat-1",
      messageId: "msg-reset-queued",
      key,
      lane: "main",
      status: "queued",
      session,
    });
    await support.writeLaneQueueOverride(db, { key });
    await support.writeSendPolicyOverride(db, { key });

    const result = await executeCommand("/reset", {
      db,
      commandContext: { agentId: "default", channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({ agent_id: "default", session_id: session.session_id });
    expect(await support.readRunStatus(db, "run-reset-dm-1")).toBe("cancelled");

    const queued = await support.readInboxStatus(db, "msg-reset-queued");
    expect(queued?.status).toBe("failed");
    expect(queued?.error).toContain("reset");
    expect(await support.readLaneQueueOverride(db, key)).toBeUndefined();
    expect(await support.readSendPolicyOverride(db, key)).toBeUndefined();
  });

  it("supports /reset for non-default channel accounts", async () => {
    db = openTestSqliteDb();

    const defaultTurns = [{ role: "user", content: "default-hi", timestamp: "default-t-1" }];
    const workTurns = [{ role: "user", content: "work-hi", timestamp: "work-t-1" }];
    const defaultSession = await support.ensureSession(db, {
      agentKey: "default",
      channel: "telegram",
      threadId: "thread-1",
      containerKind: "channel",
    });
    const workSession = await support.ensureSession(db, {
      agentKey: "default",
      channel: "telegram",
      accountKey: "work",
      threadId: "thread-1",
      containerKind: "channel",
    });

    await support.writeSessionState(db, defaultSession, {
      summary: "default-to-keep",
      turns: defaultTurns,
    });
    await support.writeSessionState(db, workSession, {
      summary: "work-to-reset",
      turns: workTurns,
    });

    const result = await executeCommand("/reset", {
      db,
      commandContext: { agentId: "default", channel: "telegram:work", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({ agent_id: "default", session_id: workSession.session_id });
    expect(await support.readSessionSnapshot(db, workSession.session_id)).toMatchObject({
      summary: "",
      turnsJson: "[]",
    });

    const defaultSnapshot = await support.readSessionSnapshot(
      db,
      defaultSession.session_id,
      DEFAULT_TENANT_ID,
    );
    expect(defaultSnapshot.summary).toBe("default-to-keep");
    expect(defaultSnapshot.turnsJson).toBe(JSON.stringify(defaultTurns));
  });
});

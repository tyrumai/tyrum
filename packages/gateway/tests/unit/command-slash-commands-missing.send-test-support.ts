import { expect, it } from "vitest";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SlashCommandFixture } from "./command-slash-commands-missing.test-support.js";

function registerBasicSendTests(fixture: SlashCommandFixture): void {
  it("supports /send <on|off|inherit>", async () => {
    const db = fixture.openDb();

    const key = "agent:default:telegram:default:dm:chat-1";

    const setOff = await executeCommand("/send off", {
      db,
      commandContext: { key },
    });
    expect(setOff.data).toMatchObject({ key, send_policy: "off" });

    const stored = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM conversation_send_policy_overrides
       WHERE tenant_id = ? AND conversation_key = ?`,
      [DEFAULT_TENANT_ID, key],
    );
    expect(stored?.send_policy).toBe("off");

    const shown = await executeCommand("/send", {
      db,
      commandContext: { key },
    });
    expect(shown.data).toMatchObject({ key, send_policy: "off" });

    const cleared = await executeCommand("/send inherit", {
      db,
      commandContext: { key },
    });
    expect(cleared.data).toMatchObject({ key, send_policy: "inherit" });

    const afterClear = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM conversation_send_policy_overrides
       WHERE tenant_id = ? AND conversation_key = ?`,
      [DEFAULT_TENANT_ID, key],
    );
    expect(afterClear).toBeUndefined();
  });

  it("supports /send using channel/thread context (resolves key)", async () => {
    const db = fixture.openDb();

    const key = "agent:default:telegram:default:dm:chat-1";

    const session = await fixture.ensureSession({
      agentKey: "default",
      channel: "telegram",
      threadId: "chat-1",
      containerKind: "dm",
    });
    await fixture.insertChannelInboxRow({
      session,
      source: "telegram:default",
      threadId: "chat-1",
      messageId: "msg-1",
      key,
      lane: "main",
      receivedAtMs: 1_000,
      status: "completed",
    });

    const result = await executeCommand("/send off", {
      db,
      commandContext: { channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({ key, send_policy: "off" });
  });
}

function registerSendResolutionTests(fixture: SlashCommandFixture): void {
  it("resolves /send with channel:default to the default-account session only", async () => {
    const db = fixture.openDb();

    const defaultKey = "agent:default:telegram:default:dm:chat-1";
    const workKey = "agent:default:telegram:work:dm:chat-1";

    const defaultSession = await fixture.ensureSession({
      agentKey: "default",
      channel: "telegram",
      threadId: "chat-1",
      containerKind: "dm",
    });
    await fixture.insertChannelInboxRow({
      session: defaultSession,
      source: "telegram:default",
      threadId: "chat-1",
      messageId: "msg-default",
      key: defaultKey,
      lane: "main",
      receivedAtMs: 1_000,
      status: "completed",
    });

    const workSession = await fixture.ensureSession({
      agentKey: "default",
      channel: "telegram",
      accountKey: "work",
      threadId: "chat-1",
      containerKind: "dm",
    });
    await fixture.insertChannelInboxRow({
      session: workSession,
      source: "telegram:work",
      threadId: "chat-1",
      messageId: "msg-work",
      key: workKey,
      lane: "main",
      receivedAtMs: 2_000,
      status: "completed",
    });

    const result = await executeCommand("/send off", {
      db,
      commandContext: { channel: "telegram:default", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({ key: defaultKey, send_policy: "off" });

    const storedDefault = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM conversation_send_policy_overrides
       WHERE tenant_id = ? AND conversation_key = ?`,
      [DEFAULT_TENANT_ID, defaultKey],
    );
    expect(storedDefault?.send_policy).toBe("off");

    const storedWork = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM conversation_send_policy_overrides
       WHERE tenant_id = ? AND conversation_key = ?`,
      [DEFAULT_TENANT_ID, workKey],
    );
    expect(storedWork).toBeUndefined();
  });

  it("resolves /send using agent_id + channel/thread context", async () => {
    const db = fixture.openDb();

    const defaultKey = "agent:default:telegram:default:dm:chat-1";
    const otherKey = "agent:agent-2:telegram:default:dm:chat-1";

    const defaultSession = await fixture.ensureSession({
      agentKey: "default",
      channel: "telegram",
      threadId: "chat-1",
      containerKind: "dm",
    });
    await fixture.insertChannelInboxRow({
      session: defaultSession,
      source: "telegram:default",
      threadId: "chat-1",
      messageId: "msg-default",
      key: defaultKey,
      lane: "main",
      receivedAtMs: 1_000,
      status: "completed",
    });

    const otherSession = await fixture.ensureSession({
      agentKey: "agent-2",
      channel: "telegram",
      threadId: "chat-1",
      containerKind: "dm",
    });
    await fixture.insertChannelInboxRow({
      session: otherSession,
      source: "telegram:default",
      threadId: "chat-1",
      messageId: "msg-other",
      key: otherKey,
      lane: "main",
      receivedAtMs: 2_000,
      status: "completed",
    });

    const result = await executeCommand("/send off", {
      db,
      commandContext: { agentId: "default", channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({ key: defaultKey, send_policy: "off" });

    const storedDefault = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM conversation_send_policy_overrides
       WHERE tenant_id = ? AND conversation_key = ?`,
      [DEFAULT_TENANT_ID, defaultKey],
    );
    expect(storedDefault?.send_policy).toBe("off");

    const storedOther = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM conversation_send_policy_overrides
       WHERE tenant_id = ? AND conversation_key = ?`,
      [DEFAULT_TENANT_ID, otherKey],
    );
    expect(storedOther).toBeUndefined();
  });

  it("fails /send inherit when clearing the override fails", async () => {
    const db = fixture.openDb();

    const key = "agent:default:telegram:default:dm:chat-1";

    await executeCommand("/send off", {
      db,
      commandContext: { key },
    });

    const failingDb = {
      kind: db.kind,
      get: db.get.bind(db),
      all: db.all.bind(db),
      run: async () => {
        throw new Error("db down");
      },
      exec: db.exec.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
    };

    const result = await executeCommand("/send inherit", {
      db: failingDb,
      commandContext: { key },
    });

    expect(result.data).toBeNull();
    expect(result.output).toContain("Failed to clear send policy override");

    const stillStored = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM conversation_send_policy_overrides
       WHERE tenant_id = ? AND conversation_key = ?`,
      [DEFAULT_TENANT_ID, key],
    );
    expect(stillStored?.send_policy).toBe("off");
  });
}

export function registerSendTests(fixture: SlashCommandFixture): void {
  registerBasicSendTests(fixture);
  registerSendResolutionTests(fixture);
}

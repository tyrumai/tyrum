import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { SlashCommandFixture } from "./command-slash-commands-missing.test-support.js";

function registerPolicyAndUsageTests(fixture: SlashCommandFixture): void {
  it("supports /policy overrides describe <policy_override_id>", async () => {
    const db = fixture.openDb();
    const policyOverrideDal = new PolicyOverrideDal(db);

    const created = await policyOverrideDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      toolId: "bash",
      pattern: "git status*",
      createdBy: { kind: "test" },
    });

    const result = await executeCommand(
      `/policy overrides describe ${created.policy_override_id}`,
      {
        policyOverrideDal,
      },
    );

    const payload = result.data as { override: { policy_override_id: string } };
    expect(payload.override.policy_override_id).toBe(created.policy_override_id);
  });

  it("supports /usage provider", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    try {
      const db = fixture.openDb();
      const nowIso = new Date().toISOString();

      const session = await fixture.ensureSession({
        agentKey: "default",
        channel: "ui",
        threadId: "thread-1",
        containerKind: "channel",
      });

      const secretId = randomUUID();
      const secretKey = "secret-openrouter-1";
      await db.run(
        `INSERT INTO secrets (tenant_id, secret_id, secret_key, status)
         VALUES (?, ?, ?, 'active')`,
        [DEFAULT_TENANT_ID, secretId, secretKey],
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
        [DEFAULT_TENANT_ID, authProfileId, "profile-openrouter-1", "openrouter", nowIso, nowIso],
      );
      await db.run(
        `INSERT INTO auth_profile_secrets (tenant_id, auth_profile_id, slot_key, secret_id)
         VALUES (?, ?, ?, ?)`,
        [DEFAULT_TENANT_ID, authProfileId, "api_key", secretId],
      );

      await db.run(
        `INSERT INTO session_provider_pins (tenant_id, session_id, provider_key, auth_profile_id, pinned_at)
         VALUES (?, ?, ?, ?, ?)`,
        [DEFAULT_TENANT_ID, session.session_id, "openrouter", authProfileId, nowIso],
      );

      const agents = {
        getSecretProvider: async () => ({
          async list() {
            return [];
          },
          async resolve() {
            return "test-token";
          },
          async store() {
            throw new Error("not implemented");
          },
          async revoke() {
            return false;
          },
        }),
      } as unknown as AgentRegistry;

      const fetchMock = vi.fn(async () => {
        return new Response(JSON.stringify({ data: { label: "test" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      const fetchImpl = fetchMock as unknown as typeof fetch;

      const first = await executeCommand("/usage provider", { db, agents, fetchImpl });
      const second = await executeCommand("/usage provider", { db, agents, fetchImpl });

      expect(first.data).toMatchObject({
        status: "ok",
        provider_key: "openrouter",
        auth_profile_key: "profile-openrouter-1",
        cached: false,
      });
      expect(second.data).toMatchObject({
        status: "ok",
        provider_key: "openrouter",
        auth_profile_key: "profile-openrouter-1",
        cached: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });

  it("returns unavailable for /usage provider without agents", async () => {
    fixture.openDb();
    const db = fixture.db()!;

    const result = await executeCommand("/usage provider", { db });

    expect(result.output).toBe("Provider usage polling is not available on this gateway instance.");
    expect(result.data).toBeNull();
  });
}

function registerQueueAndIntakeTests(fixture: SlashCommandFixture): void {
  it("supports /queue <collect|followup|steer|steer_backlog|interrupt>", async () => {
    const db = fixture.openDb();

    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";

    const result = await executeCommand("/queue interrupt", {
      db,
      commandContext: { key, lane },
    });

    expect(result.data).toMatchObject({
      key,
      lane,
      queue_mode: "interrupt",
    });

    const row = await db.get<{ queue_mode: string }>(
      `SELECT queue_mode
       FROM lane_queue_mode_overrides
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [DEFAULT_TENANT_ID, key, lane],
    );
    expect(row?.queue_mode).toBe("interrupt");
  });

  it("supports /queue using channel/thread context (resolves key + lane)", async () => {
    const db = fixture.openDb();

    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";

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
      lane,
      receivedAtMs: 1_000,
      status: "completed",
    });

    const result = await executeCommand("/queue interrupt", {
      db,
      commandContext: { channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({
      key,
      lane,
      queue_mode: "interrupt",
    });
  });

  it("supports /queue using channel:account + thread context", async () => {
    const db = fixture.openDb();

    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";

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
      lane,
      receivedAtMs: 1_000,
      status: "completed",
    });

    const result = await executeCommand("/queue interrupt", {
      db,
      commandContext: { channel: "telegram:default", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({
      key,
      lane,
      queue_mode: "interrupt",
    });
  });

  it("supports /queue (show)", async () => {
    const db = fixture.openDb();

    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";

    await executeCommand("/queue interrupt", {
      db,
      commandContext: { key, lane },
    });

    const result = await executeCommand("/queue", {
      db,
      commandContext: { key, lane },
    });

    expect(result.data).toMatchObject({
      key,
      lane,
      queue_mode: "interrupt",
    });
  });
}

export function registerCommandsTests(fixture: SlashCommandFixture): void {
  registerPolicyAndUsageTests(fixture);
  registerQueueAndIntakeTests(fixture);
}

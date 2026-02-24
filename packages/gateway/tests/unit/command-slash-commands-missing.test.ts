import { afterEach, describe, expect, it, vi } from "vitest";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { ModelsDevService } from "../../src/modules/models/models-dev-service.js";

describe("missing slash commands", () => {
  let db: ReturnType<typeof openTestSqliteDb> | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("supports /policy overrides describe <policy_override_id>", async () => {
    db = openTestSqliteDb();
    const policyOverrideDal = new PolicyOverrideDal(db);

    const created = await policyOverrideDal.create({
      agentId: "default",
      toolId: "tool.exec",
      pattern: "git status*",
      createdBy: { kind: "test" },
    });

    const result = await executeCommand(`/policy overrides describe ${created.policy_override_id}`, {
      policyOverrideDal,
    });

    const payload = result.data as { override: { policy_override_id: string } };
    expect(payload.override.policy_override_id).toBe(created.policy_override_id);
  });

  it("supports /usage provider", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    try {
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
         ) VALUES (?, ?, ?, ?, '', '[]', ?, ?)`,
        ["default", "ui:thread-1", "ui", "thread-1", nowIso, nowIso],
      );

      await db.run(
        `INSERT INTO auth_profiles (
           profile_id,
           agent_id,
           provider,
           type,
           secret_handles_json,
           labels_json,
           status,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'api_key', ?, '{}', 'active', ?, ?)`,
        [
          "profile-openrouter-1",
          "default",
          "openrouter",
          JSON.stringify({ api_key_handle: "handle-openrouter-1" }),
          nowIso,
          nowIso,
        ],
      );

      await db.run(
        `INSERT INTO session_provider_pins (
           agent_id,
           session_id,
           provider,
           profile_id,
           pinned_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        ["default", "ui:thread-1", "openrouter", "profile-openrouter-1", nowIso, nowIso],
      );

      const agents = {
        getSecretProvider: async () => ({
          async list() {
            return [
              {
                handle_id: "handle-openrouter-1",
                provider: "env",
                scope: "OPENROUTER_API_KEY",
                created_at: nowIso,
              },
            ];
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
        provider: "openrouter",
        profile_id: "profile-openrouter-1",
        cached: false,
      });
      expect(second.data).toMatchObject({
        status: "ok",
        provider: "openrouter",
        profile_id: "profile-openrouter-1",
        cached: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });

  it("returns unavailable for /usage provider without agents", async () => {
    db = openTestSqliteDb();

    const result = await executeCommand("/usage provider", { db });

    expect(result.output).toBe("Provider usage polling is not available on this gateway instance.");
    expect(result.data).toBeNull();
  });

  it("supports /model <provider/model> for a session", async () => {
    db = openTestSqliteDb();

    const result = await executeCommand("/model openai/gpt-4.1", {
      db,
      commandContext: {
        agentId: "default",
        channel: "ui",
        threadId: "thread-1",
      },
    });

    expect(result.data).toMatchObject({
      session_id: "ui:thread-1",
      model_id: "openai/gpt-4.1",
    });

    const row = await db.get<{ model_id: string }>(
      `SELECT model_id
       FROM session_model_overrides
       WHERE agent_id = ? AND session_id = ?`,
      ["default", "ui:thread-1"],
    );
    expect(row?.model_id).toBe("openai/gpt-4.1");
  });

  it("supports /model using key/lane context (resolves session)", async () => {
    db = openTestSqliteDb();

    const nowMs = Date.now();
    const key = "agent:default:telegram:work:group:thread-1";

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
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`,
      ["telegram:work", "thread-1", "msg-1", key, "main", nowMs, "{}"],
    );

    const result = await executeCommand("/model openai/gpt-4.1", {
      db,
      commandContext: { key, lane: "main" },
    });

    expect(result.data).toMatchObject({
      session_id: "telegram:thread-1",
      model_id: "openai/gpt-4.1",
    });

    const row = await db.get<{ model_id: string }>(
      `SELECT model_id
       FROM session_model_overrides
       WHERE agent_id = ? AND session_id = ?`,
      ["default", "telegram:thread-1"],
    );
    expect(row?.model_id).toBe("openai/gpt-4.1");
  });

  it("supports /model (show) for a session", async () => {
    db = openTestSqliteDb();

    await executeCommand("/model openai/gpt-4.1", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });

    const result = await executeCommand("/model", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({
      session_id: "ui:thread-1",
      model_id: "openai/gpt-4.1",
    });
  });

  it("supports /model <provider/model>@<profile> for a session", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    try {
      db = openTestSqliteDb();
      const nowIso = new Date().toISOString();

      await db.run(
        `INSERT INTO auth_profiles (
           profile_id,
           agent_id,
           provider,
           type,
           secret_handles_json,
           labels_json,
           status,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'api_key', ?, '{}', 'active', ?, ?)`,
        [
          "profile-openrouter-1",
          "default",
          "openrouter",
          JSON.stringify({ api_key_handle: "handle-openrouter-1" }),
          nowIso,
          nowIso,
        ],
      );

      const result = await executeCommand("/model openrouter/gpt-4o@profile-openrouter-1", {
        db,
        commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
      });

      expect(result.data).toMatchObject({
        session_id: "ui:thread-1",
        model_id: "openrouter/gpt-4o",
        profile_id: "profile-openrouter-1",
        provider: "openrouter",
      });

      const override = await db.get<{ model_id: string }>(
        `SELECT model_id
         FROM session_model_overrides
         WHERE agent_id = ? AND session_id = ?`,
        ["default", "ui:thread-1"],
      );
      expect(override?.model_id).toBe("openrouter/gpt-4o");

      const pin = await db.get<{ profile_id: string }>(
        `SELECT profile_id
         FROM session_provider_pins
         WHERE agent_id = ? AND session_id = ? AND provider = ?`,
        ["default", "ui:thread-1", "openrouter"],
      );
      expect(pin?.profile_id).toBe("profile-openrouter-1");
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });

  it("does not persist /model override when auth profiles are disabled", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "0";

    try {
      db = openTestSqliteDb();

      const result = await executeCommand("/model openrouter/gpt-4o@profile-openrouter-1", {
        db,
        commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
      });

      expect(result.data).toBeNull();

      const override = await db.get<{ model_id: string }>(
        `SELECT model_id
         FROM session_model_overrides
         WHERE agent_id = ? AND session_id = ?`,
        ["default", "ui:thread-1"],
      );
      expect(override).toBeUndefined();

      const pin = await db.get<{ profile_id: string }>(
        `SELECT profile_id
         FROM session_provider_pins
         WHERE agent_id = ? AND session_id = ? AND provider = ?`,
        ["default", "ui:thread-1", "openrouter"],
      );
      expect(pin).toBeUndefined();
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });

  it("does not persist /model override when the auth profile is missing", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    try {
      db = openTestSqliteDb();

      const result = await executeCommand("/model openrouter/gpt-4o@profile-missing", {
        db,
        commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
      });

      expect(result.data).toBeNull();

      const override = await db.get<{ model_id: string }>(
        `SELECT model_id
         FROM session_model_overrides
         WHERE agent_id = ? AND session_id = ?`,
        ["default", "ui:thread-1"],
      );
      expect(override).toBeUndefined();

      const pin = await db.get<{ profile_id: string }>(
        `SELECT profile_id
         FROM session_provider_pins
         WHERE agent_id = ? AND session_id = ? AND provider = ?`,
        ["default", "ui:thread-1", "openrouter"],
      );
      expect(pin).toBeUndefined();
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });

  it("rejects /model <provider/model> when the model is missing from models.dev catalog", async () => {
    db = openTestSqliteDb();

    const modelsDev: ModelsDevService = {
      ensureLoaded: async () => ({
        catalog: {
          openai: {
            id: "openai",
            name: "OpenAI",
            env: [],
            npm: "@ai-sdk/openai",
            models: {
              "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" },
            },
          },
        },
        status: {
          source: "bundled",
          fetched_at: null,
          updated_at: new Date().toISOString(),
          etag: null,
          sha256: "sha",
          provider_count: 1,
          model_count: 1,
          last_error: null,
        },
      }),
    } as unknown as ModelsDevService;

    const result = await executeCommand("/model openai/not-a-real-model", {
      db,
      modelsDev,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });

    expect(result.data).toBeNull();

    const stored = await db.get<{ model_id: string }>(
      `SELECT model_id
       FROM session_model_overrides
       WHERE agent_id = ? AND session_id = ?`,
      ["default", "ui:thread-1"],
    );
    expect(stored).toBeUndefined();
  });

  it("supports /queue <collect|followup|steer|steer_backlog|interrupt>", async () => {
    db = openTestSqliteDb();

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
       WHERE key = ? AND lane = ?`,
      [key, lane],
    );
    expect(row?.queue_mode).toBe("interrupt");
  });

  it("supports /queue using channel/thread context (resolves key + lane)", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";

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
      ["telegram", "chat-1", "msg-1", key, lane, 1_000],
    );

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

  it("supports /queue (show)", async () => {
    db = openTestSqliteDb();

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

  it("supports /send <on|off|inherit>", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:telegram:default:dm:chat-1";

    const setOff = await executeCommand("/send off", {
      db,
      commandContext: { key },
    });
    expect(setOff.data).toMatchObject({ key, send_policy: "off" });

    const stored = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM session_send_policy_overrides
       WHERE key = ?`,
      [key],
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
       FROM session_send_policy_overrides
       WHERE key = ?`,
      [key],
    );
    expect(afterClear).toBeUndefined();
  });

  it("supports /send using channel/thread context (resolves key)", async () => {
    db = openTestSqliteDb();

    const key = "agent:default:telegram:default:dm:chat-1";

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
       ) VALUES (?, ?, ?, ?, 'main', ?, '{}', 'completed')`,
      ["telegram", "chat-1", "msg-1", key, 1_000],
    );

    const result = await executeCommand("/send off", {
      db,
      commandContext: { channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({ key, send_policy: "off" });
  });

  it("resolves /send using agent_id + channel/thread context", async () => {
    db = openTestSqliteDb();

    const defaultKey = "agent:default:telegram:default:dm:chat-1";
    const otherKey = "agent:agent-2:telegram:default:dm:chat-1";

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
       ) VALUES (?, ?, ?, ?, 'main', ?, '{}', 'completed')`,
      ["telegram", "chat-1", "msg-default", defaultKey, 1_000],
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
       ) VALUES (?, ?, ?, ?, 'main', ?, '{}', 'completed')`,
      ["telegram", "chat-1", "msg-other", otherKey, 2_000],
    );

    const result = await executeCommand("/send off", {
      db,
      commandContext: { agentId: "default", channel: "telegram", threadId: "chat-1" },
    });

    expect(result.data).toMatchObject({ key: defaultKey, send_policy: "off" });

    const storedDefault = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM session_send_policy_overrides
       WHERE key = ?`,
      [defaultKey],
    );
    expect(storedDefault?.send_policy).toBe("off");

    const storedOther = await db.get<{ send_policy: string }>(
      `SELECT send_policy
       FROM session_send_policy_overrides
       WHERE key = ?`,
      [otherKey],
    );
    expect(storedOther).toBeUndefined();
  });

  it("fails /send inherit when clearing the override fails", async () => {
    db = openTestSqliteDb();

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
       FROM session_send_policy_overrides
       WHERE key = ?`,
      [key],
    );
    expect(stillStored?.send_policy).toBe("off");
  });
});

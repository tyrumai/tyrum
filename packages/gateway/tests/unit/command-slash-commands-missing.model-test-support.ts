import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { ModelsDevService } from "../../src/modules/models/models-dev-service.js";
import type { SlashCommandFixture } from "./command-slash-commands-missing.test-support.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function registerBasicModelTests(fixture: SlashCommandFixture): void {
  it("supports /model <provider/model> for a conversation", async () => {
    const db = fixture.openDb();

    const result = await executeCommand("/model openai/gpt-4.1", {
      db,
      commandContext: {
        agentId: "default",
        channel: "ui",
        threadId: "thread-1",
      },
    });

    const payload = result.data as { conversation_id: string; model_id: string };
    expect(payload.model_id).toBe("openai/gpt-4.1");
    expect(payload.conversation_id).toMatch(UUID_RE);

    const row = await db.get<{ model_id: string }>(
      `SELECT model_id
       FROM conversation_model_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [DEFAULT_TENANT_ID, payload.conversation_id],
    );
    expect(row?.model_id).toBe("openai/gpt-4.1");
  });

  it("supports /model using conversation-key context", async () => {
    const db = fixture.openDb();

    const nowMs = Date.now();
    const key = "agent:default:telegram:work:channel:thread-1";

    const defaultConversation = await fixture.ensureConversation({
      agentKey: "default",
      channel: "telegram",
      threadId: "thread-1",
      containerKind: "channel",
    });

    const conversation = await fixture.ensureConversation({
      agentKey: "default",
      channel: "telegram",
      accountKey: "work",
      threadId: "thread-1",
      containerKind: "channel",
    });
    await fixture.insertChannelInboxRow({
      conversation,
      source: "telegram:work",
      threadId: "thread-1",
      messageId: "msg-1",
      key,
      receivedAtMs: nowMs,
      status: "completed",
    });

    const result = await executeCommand("/model openai/gpt-4.1", {
      db,
      commandContext: { key },
    });

    const payload = result.data as { conversation_id: string; model_id: string };
    expect(payload.model_id).toBe("openai/gpt-4.1");
    expect(payload.conversation_id).toBe(conversation.conversation_id);

    const row = await db.get<{ model_id: string }>(
      `SELECT model_id
       FROM conversation_model_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [DEFAULT_TENANT_ID, payload.conversation_id],
    );
    expect(row?.model_id).toBe("openai/gpt-4.1");

    const defaultRow = await db.get<{ model_id: string }>(
      `SELECT model_id
       FROM conversation_model_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [DEFAULT_TENANT_ID, defaultConversation.conversation_id],
    );
    expect(defaultRow).toBeUndefined();
  });

  it("supports /model using key-only account-scoped fallback (without inbox row)", async () => {
    const db = fixture.openDb();

    const key = "agent:default:telegram:work:channel:thread-fallback";

    const defaultConversation = await fixture.ensureConversation({
      agentKey: "default",
      channel: "telegram",
      threadId: "thread-fallback",
      containerKind: "channel",
    });
    const workConversation = await fixture.ensureConversation({
      agentKey: "default",
      channel: "telegram",
      accountKey: "work",
      threadId: "thread-fallback",
      containerKind: "channel",
    });

    const result = await executeCommand("/model openai/gpt-4.1", {
      db,
      commandContext: { key },
    });

    const payload = result.data as { conversation_id: string; model_id: string };
    expect(payload.model_id).toBe("openai/gpt-4.1");
    expect(payload.conversation_id).toBe(workConversation.conversation_id);

    const defaultRow = await db.get<{ model_id: string }>(
      `SELECT model_id
       FROM conversation_model_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [DEFAULT_TENANT_ID, defaultConversation.conversation_id],
    );
    expect(defaultRow).toBeUndefined();
  });

  it("supports /model (show) for a conversation", async () => {
    fixture.openDb();
    const db = fixture.db()!;

    const set = await executeCommand("/model openai/gpt-4.1", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });
    const setPayload = set.data as { conversation_id: string };

    const result = await executeCommand("/model", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({
      conversation_id: setPayload.conversation_id,
      model_id: "openai/gpt-4.1",
    });
  });
}

function registerPresetTests(fixture: SlashCommandFixture): void {
  it("supports /model <preset_key> for a conversation", async () => {
    const db = fixture.openDb();
    await fixture.createConfiguredPreset({
      presetKey: "anthropic-default",
      displayName: "Anthropic Default",
      providerKey: "anthropic",
      modelId: "claude-3.5-sonnet",
      options: { reasoning_effort: "high" },
    });

    const result = await executeCommand("/model anthropic-default", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-preset" },
    });

    const payload = result.data as {
      conversation_id: string;
      model_id: string;
      preset_key: string;
    };
    expect(payload).toMatchObject({
      model_id: "anthropic/claude-3.5-sonnet",
      preset_key: "anthropic-default",
    });

    const row = await db.get<{ model_id: string; preset_key: string | null }>(
      `SELECT model_id, preset_key
       FROM conversation_model_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [DEFAULT_TENANT_ID, payload.conversation_id],
    );
    expect(row).toEqual({
      model_id: "anthropic/claude-3.5-sonnet",
      preset_key: "anthropic-default",
    });
  });

  it("reports misconfigured configured presets without blaming user input", async () => {
    const db = fixture.openDb();
    const nowIso = new Date().toISOString();

    await db.run(
      `INSERT INTO configured_model_presets (
         tenant_id,
         preset_id,
         preset_key,
         display_name,
         provider_key,
         model_id,
         options_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        randomUUID(),
        "broken-preset",
        "Broken preset",
        "",
        "gpt-4.1",
        nowIso,
        nowIso,
      ],
    );

    const result = await executeCommand("/model broken-preset", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-broken-preset" },
    });

    expect(result.data).toBeNull();
    expect(result.output).toBe("Configured model preset 'broken-preset' is misconfigured.");
  });

  it("resolves /model <provider/model> to a unique configured preset", async () => {
    const db = fixture.openDb();
    await fixture.createConfiguredPreset({
      presetKey: "anthropic-default",
      displayName: "Anthropic Default",
      providerKey: "anthropic",
      modelId: "claude-3.5-sonnet",
      options: { reasoning_effort: "medium" },
    });

    const result = await executeCommand("/model anthropic/claude-3.5-sonnet", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-unique" },
    });

    const payload = result.data as {
      conversation_id: string;
      model_id: string;
      preset_key: string;
    };
    expect(payload).toMatchObject({
      model_id: "anthropic/claude-3.5-sonnet",
      preset_key: "anthropic-default",
    });
  });

  it("rejects /model <provider/model> when multiple configured presets target the same model", async () => {
    const db = fixture.openDb();
    await fixture.createConfiguredPreset({
      presetKey: "anthropic-default",
      displayName: "Anthropic Default",
      providerKey: "anthropic",
      modelId: "claude-3.5-sonnet",
    });
    await fixture.createConfiguredPreset({
      presetKey: "anthropic-review",
      displayName: "Anthropic Review",
      providerKey: "anthropic",
      modelId: "claude-3.5-sonnet",
    });

    const result = await executeCommand("/model anthropic/claude-3.5-sonnet", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-ambiguous" },
    });

    expect(result.data).toBeNull();
    expect(result.output).toContain("matches multiple configured presets");
    expect(result.output).toContain("anthropic-default");
    expect(result.output).toContain("anthropic-review");
  });
}

function registerAuthProfileTests(fixture: SlashCommandFixture): void {
  it("supports /model <provider/model>@<profile> for a conversation", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    try {
      const db = fixture.openDb();
      const nowIso = new Date().toISOString();

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

      const result = await executeCommand("/model openrouter/gpt-4o@profile-openrouter-1", {
        db,
        commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
      });

      const payload = result.data as {
        conversation_id: string;
        model_id: string;
        provider_key: string;
        auth_profile_id: string;
        auth_profile_key: string;
      };
      expect(payload.conversation_id).toMatch(UUID_RE);
      expect(payload).toMatchObject({
        model_id: "openrouter/gpt-4o",
        provider_key: "openrouter",
        auth_profile_id: authProfileId,
        auth_profile_key: "profile-openrouter-1",
      });

      const override = await db.get<{ model_id: string; preset_key: string | null }>(
        `SELECT model_id, preset_key
         FROM conversation_model_overrides
         WHERE tenant_id = ? AND conversation_id = ?`,
        [DEFAULT_TENANT_ID, payload.conversation_id],
      );
      expect(override).toEqual({
        model_id: "openrouter/gpt-4o",
        preset_key: null,
      });

      const pin = await db.get<{ auth_profile_id: string }>(
        `SELECT auth_profile_id
         FROM conversation_provider_pins
         WHERE tenant_id = ? AND conversation_id = ? AND provider_key = ?`,
        [DEFAULT_TENANT_ID, payload.conversation_id, "openrouter"],
      );
      expect(pin?.auth_profile_id).toBe(authProfileId);
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });

  it("clears any pinned auth profile when /model is set without @profile", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "1";

    try {
      const db = fixture.openDb();
      const nowIso = new Date().toISOString();

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

      const withProfile = await executeCommand("/model openrouter/gpt-4o@profile-openrouter-1", {
        db,
        commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
      });
      const withPayload = withProfile.data as { conversation_id: string };

      const before = await db.get<{ auth_profile_id: string }>(
        `SELECT auth_profile_id
         FROM conversation_provider_pins
         WHERE tenant_id = ? AND conversation_id = ? AND provider_key = ?`,
        [DEFAULT_TENANT_ID, withPayload.conversation_id, "openrouter"],
      );
      expect(before?.auth_profile_id).toBe(authProfileId);

      await executeCommand("/model openrouter/gpt-4o", {
        db,
        commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
      });

      const after = await db.get<{ auth_profile_id: string }>(
        `SELECT auth_profile_id
         FROM conversation_provider_pins
         WHERE tenant_id = ? AND conversation_id = ? AND provider_key = ?`,
        [DEFAULT_TENANT_ID, withPayload.conversation_id, "openrouter"],
      );
      expect(after).toBeUndefined();
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });

  it("does not persist /model override when auth profiles are disabled", async () => {
    const prevEnabled = process.env["TYRUM_AUTH_PROFILES_ENABLED"];
    process.env["TYRUM_AUTH_PROFILES_ENABLED"] = "0";

    try {
      const db = fixture.openDb();

      const conversation = await fixture.ensureConversation({
        agentKey: "default",
        channel: "ui",
        threadId: "thread-1",
        containerKind: "channel",
      });

      const result = await executeCommand("/model openrouter/gpt-4o@profile-openrouter-1", {
        db,
        commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
      });

      expect(result.data).toBeNull();

      const override = await db.get<{ model_id: string }>(
        `SELECT model_id
         FROM conversation_model_overrides
         WHERE tenant_id = ? AND conversation_id = ?`,
        [DEFAULT_TENANT_ID, conversation.conversation_id],
      );
      expect(override).toBeUndefined();

      const pin = await db.get<{ auth_profile_id: string }>(
        `SELECT auth_profile_id
         FROM conversation_provider_pins
         WHERE tenant_id = ? AND conversation_id = ? AND provider_key = ?`,
        [DEFAULT_TENANT_ID, conversation.conversation_id, "openrouter"],
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
      const db = fixture.openDb();

      const conversation = await fixture.ensureConversation({
        agentKey: "default",
        channel: "ui",
        threadId: "thread-1",
        containerKind: "channel",
      });

      const result = await executeCommand("/model openrouter/gpt-4o@profile-missing", {
        db,
        commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
      });

      expect(result.data).toBeNull();

      const override = await db.get<{ model_id: string }>(
        `SELECT model_id
         FROM conversation_model_overrides
         WHERE tenant_id = ? AND conversation_id = ?`,
        [DEFAULT_TENANT_ID, conversation.conversation_id],
      );
      expect(override).toBeUndefined();

      const pin = await db.get<{ auth_profile_id: string }>(
        `SELECT auth_profile_id
         FROM conversation_provider_pins
         WHERE tenant_id = ? AND conversation_id = ? AND provider_key = ?`,
        [DEFAULT_TENANT_ID, conversation.conversation_id, "openrouter"],
      );
      expect(pin).toBeUndefined();
    } finally {
      process.env["TYRUM_AUTH_PROFILES_ENABLED"] = prevEnabled;
    }
  });

  it("rejects /model <provider/model> when the model is missing from models.dev catalog", async () => {
    const db = fixture.openDb();

    const conversation = await fixture.ensureConversation({
      agentKey: "default",
      channel: "ui",
      threadId: "thread-1",
      containerKind: "channel",
    });

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
       FROM conversation_model_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [DEFAULT_TENANT_ID, conversation.conversation_id],
    );
    expect(stored).toBeUndefined();
  });
}

export function registerModelTests(fixture: SlashCommandFixture): void {
  registerBasicModelTests(fixture);
  registerPresetTests(fixture);
  registerAuthProfileTests(fixture);
}

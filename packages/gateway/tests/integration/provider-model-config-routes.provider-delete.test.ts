import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import {
  ModelsDevCacheDal,
  DEFAULT_TENANT_ID,
  seedCatalog,
  modelResponse,
  catalogFor,
  createProviderAccount,
  createDefaultConversation,
  insertApiKeyProfile,
  insertConversationModelOverride,
} from "./provider-model-config-routes.test-support.js";

describe("provider config route provider deletion cleanup", () => {
  it("removes direct conversation model overrides when deleting a provider", async () => {
    const { app, container } = await createTestApp();
    await seedCatalog(
      new ModelsDevCacheDal(container.db),
      catalogFor("anthropic", {
        "claude-3.5-sonnet": modelResponse("claude-3.5-sonnet", "Claude 3.5 Sonnet"),
      }),
    );

    const accountRes = await createProviderAccount(app, {
      provider_key: "anthropic",
      display_name: "Primary Anthropic",
      method_key: "api_key",
      config: {},
      secrets: { api_key: "sk-test-direct-override" },
    });
    expect(accountRes.status).toBe(201);

    const conversation = await createDefaultConversation(container, "thread-direct");
    await insertConversationModelOverride(
      container,
      conversation.conversation_id,
      "anthropic/claude-3.5-sonnet",
    );

    const deleteRes = await app.request("/config/providers/anthropic", { method: "DELETE" });
    expect(deleteRes.status).toBe(200);

    const override = await container.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM conversation_model_overrides
       WHERE tenant_id = ? AND model_id = ?`,
      [DEFAULT_TENANT_ID, "anthropic/claude-3.5-sonnet"],
    );
    expect(override?.count).toBe(0);
  });

  it("escapes provider keys when deleting direct conversation model overrides", async () => {
    const { app, container } = await createTestApp();
    const wildcardProviderKey = "open_ai";
    const otherProviderKey = "openxai";

    await insertApiKeyProfile(container, "wildcard-account", wildcardProviderKey);
    await insertApiKeyProfile(container, "other-account", otherProviderKey);

    const wildcardConversation = await createDefaultConversation(container, "thread-wildcard");
    const otherConversation = await createDefaultConversation(container, "thread-other");

    await insertConversationModelOverride(
      container,
      wildcardConversation.conversation_id,
      `${wildcardProviderKey}/gpt-4.1`,
    );
    await insertConversationModelOverride(
      container,
      otherConversation.conversation_id,
      `${otherProviderKey}/gpt-4.1`,
    );

    const deleteRes = await app.request(
      `/config/providers/${encodeURIComponent(wildcardProviderKey)}`,
      { method: "DELETE" },
    );
    expect(deleteRes.status).toBe(200);

    const overrides = await container.db.all<{ model_id: string }>(
      `SELECT model_id
       FROM conversation_model_overrides
       WHERE tenant_id = ?
       ORDER BY model_id ASC`,
      [DEFAULT_TENANT_ID],
    );
    expect(overrides).toEqual([{ model_id: `${otherProviderKey}/gpt-4.1` }]);
  });
});

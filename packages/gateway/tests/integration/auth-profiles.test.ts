import { describe, expect, it } from "vitest";
import {
  ConversationProviderPinListResponse,
  ConversationProviderPinSetResponse,
} from "@tyrum/contracts";
import { createTestApp } from "./helpers.js";

describe("auth profile routes", () => {
  it("creates, lists, and disables profiles", async () => {
    const { app } = await createTestApp();

    const createRes = await app.request("/auth/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        auth_profile_key: "openai-default",
        provider_key: "openai",
        type: "api_key",
        secret_keys: {},
        labels: { email: "test@example.com" },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      profile: { auth_profile_id: string; auth_profile_key: string; status: string };
    };
    expect(created.profile.auth_profile_id).toBeTypeOf("string");
    expect(created.profile.auth_profile_key).toBe("openai-default");
    expect(created.profile.status).toBe("active");

    const listRes = await app.request("/auth/profiles");
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { profiles: Array<{ auth_profile_key: string }> };
    expect(
      listed.profiles.some((p) => p.auth_profile_key === created.profile.auth_profile_key),
    ).toBe(true);

    const disableRes = await app.request(
      `/auth/profiles/${created.profile.auth_profile_key}/disable`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "test" }),
      },
    );
    expect(disableRes.status).toBe(200);
    const disabled = (await disableRes.json()) as { profile: { status: string } };
    expect(disabled.profile.status).toBe("disabled");
  });

  it("sets and lists conversation auth pins with the conversation contract shape", async () => {
    const { app, auth, container } = await createTestApp();

    const createRes = await app.request("/auth/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        auth_profile_key: "openai-default",
        provider_key: "openai",
        type: "api_key",
        secret_keys: {},
      }),
    });
    expect(createRes.status).toBe(201);

    const conversation = await container.conversationDal.getOrCreate({
      tenantId: auth.tenantId,
      connectorKey: "ui",
      providerThreadId: "auth-pins-test-thread",
      containerKind: "channel",
    });
    const conversationId = conversation.conversation_id;

    const setRes = await app.request("/auth/pins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        provider_key: "openai",
        auth_profile_key: "openai-default",
      }),
    });
    expect(setRes.status).toBe(201);
    const setBody = ConversationProviderPinSetResponse.parse(await setRes.json());
    expect(setBody.pin.conversation_id).toBe(conversationId);
    expect("session_id" in (setBody.pin as Record<string, unknown>)).toBe(false);

    const listRes = await app.request(
      `/auth/pins?conversation_id=${encodeURIComponent(conversationId)}&provider_key=openai`,
    );
    expect(listRes.status).toBe(200);
    const listed = ConversationProviderPinListResponse.parse(await listRes.json());
    expect(listed.pins).toHaveLength(1);
    expect(listed.pins[0]?.conversation_id).toBe(conversationId);
    expect("session_id" in ((listed.pins[0] ?? {}) as Record<string, unknown>)).toBe(false);
  });
});

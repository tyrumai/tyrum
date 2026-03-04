import { describe, expect, it } from "vitest";
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
});

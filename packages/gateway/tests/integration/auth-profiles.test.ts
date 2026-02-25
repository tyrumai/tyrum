import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("auth profile routes", () => {
  it("creates, lists, and disables profiles", async () => {
    const { app } = await createTestApp();

    const createRes = await app.request("/auth/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        type: "api_key",
        secret_handles: { api_key_handle: "handle-1" },
        labels: { email: "test@example.com" },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { profile: { profile_id: string; status: string } };
    expect(created.profile.profile_id).toBeTypeOf("string");
    expect(created.profile.status).toBe("active");

    const listRes = await app.request("/auth/profiles");
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { profiles: Array<{ profile_id: string }> };
    expect(listed.profiles.some((p) => p.profile_id === created.profile.profile_id)).toBe(true);

    const disableRes = await app.request(`/auth/profiles/${created.profile.profile_id}/disable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "test" }),
    });
    expect(disableRes.status).toBe(200);
    const disabled = (await disableRes.json()) as {
      profile: { status: string; disabled_reason?: string | null };
    };
    expect(disabled.profile.status).toBe("disabled");
  });
});

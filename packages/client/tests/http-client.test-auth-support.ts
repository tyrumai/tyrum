import { expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import {
  createTestClient,
  jsonResponse,
  makeFetchMock,
  mockJsonFetch,
  sampleAuthProfile,
} from "./http-client.test-support.js";

export function registerHttpClientAuthTests(): void {
  it("authProfiles.create sends POST /auth/profiles and expects 201", async () => {
    const profile = sampleAuthProfile();
    const fetch = makeFetchMock(async () => jsonResponse({ profile }, 201));
    const client = createTestClient({ fetch });

    const result = await client.authProfiles.create({
      auth_profile_key: "openai-default",
      provider_key: "openai",
      type: "api_key",
      secret_keys: { api_key: "handle-1" },
    });
    expect(result.profile.provider_key).toBe("openai");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/auth/profiles");
    expect(init.method).toBe("POST");
  });

  it("authProfiles.update sends PATCH /auth/profiles/:id with encoded path", async () => {
    const profile = sampleAuthProfile();
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok", profile }));
    const client = createTestClient({ fetch });

    await client.authProfiles.update("id/with-slash", { labels: { env: "test" } });

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/auth/profiles/id%2Fwith-slash");
    expect(init.method).toBe("PATCH");
  });

  it("authProfiles.disable sends POST /auth/profiles/:id/disable", async () => {
    const profile = { ...sampleAuthProfile(), status: "disabled" };
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok", profile }));
    const client = createTestClient({ fetch });

    const result = await client.authProfiles.disable("prof-1", { reason: "test" });
    expect(result.status).toBe("ok");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/auth/profiles/prof-1/disable");
    expect(init.method).toBe("POST");
  });

  it("authProfiles.enable sends POST /auth/profiles/:id/enable", async () => {
    const profile = sampleAuthProfile();
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok", profile }));
    const client = createTestClient({ fetch });

    const result = await client.authProfiles.enable("prof-1", {});
    expect(result.profile.status).toBe("active");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/auth/profiles/prof-1/enable");
    expect(init.method).toBe("POST");
  });

  // --- Auth pins ---

  it("authPins.list sends GET /auth/pins with query params", async () => {
    const fetch = mockJsonFetch({ pins: [] });
    const client = createTestClient({ fetch });

    await client.authPins.list({
      session_id: "550e8400-e29b-41d4-a716-446655440000",
      provider_key: "openai",
    });

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe(
      "https://gateway.example/auth/pins?session_id=550e8400-e29b-41d4-a716-446655440000&provider_key=openai",
    );
  });

  it("authPins.set branches on profile_id null (clear) vs set (201)", async () => {
    const pin = {
      session_id: "550e8400-e29b-41d4-a716-446655440000",
      provider_key: "openai",
      auth_profile_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      auth_profile_key: "openai-default",
      pinned_at: "2026-02-25T00:00:00.000Z",
    };

    const fetchSet = mockJsonFetch({ status: "ok", pin }, 201);
    const clientSet = createTestClient({ fetch: fetchSet });

    const setResult = await clientSet.authPins.set({
      session_id: "550e8400-e29b-41d4-a716-446655440000",
      provider_key: "openai",
      auth_profile_key: "openai-default",
    });
    expect(setResult.status).toBe("ok");
    expect("pin" in setResult).toBe(true);

    const fetchClear = mockJsonFetch({ status: "ok", cleared: true });
    const clientClear = createTestClient({ fetch: fetchClear });

    const clearResult = await clientClear.authPins.set({
      session_id: "550e8400-e29b-41d4-a716-446655440000",
      provider_key: "openai",
      auth_profile_key: null,
    });
    expect(clearResult.status).toBe("ok");
    expect("cleared" in clearResult).toBe(true);
  });

  // --- Secrets ---

  it("secrets.store sends POST /secrets with body and expects 201", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse(
        {
          handle: {
            handle_id: "my-secret",
            provider: "db",
            scope: "my-secret",
            created_at: "2026-02-25T00:00:00.000Z",
          },
        },
        201,
      ),
    );
    const client = createTestClient({ fetch });

    const result = await client.secrets.store({ secret_key: "my-secret", value: "s3cret" });
    expect(result.handle.handle_id).toBe("my-secret");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/secrets");
    expect(init.method).toBe("POST");
  });

  it("secrets.revoke sends DELETE /secrets/:id with query", async () => {
    const fetch = mockJsonFetch({ revoked: true });
    const client = createTestClient({ fetch });

    const result = await client.secrets.revoke("secret-1", { agent_key: "agent-1" });
    expect(result.revoked).toBe(true);

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/secrets/secret-1?agent_key=agent-1");
    expect(init.method).toBe("DELETE");
  });

  it("secrets.rotate sends POST /secrets/:id/rotate and expects 201", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse(
        {
          revoked: true,
          handle: {
            handle_id: "secret-1",
            provider: "db",
            scope: "secret-1",
            created_at: "2026-02-25T00:00:00.000Z",
          },
        },
        201,
      ),
    );
    const client = createTestClient({ fetch });

    const result = await client.secrets.rotate("secret-1", { value: "new-s3cret" });
    expect(result.handle.handle_id).toBe("secret-1");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/secrets/secret-1/rotate");
    expect(init.method).toBe("POST");
  });

  // --- Policy ---
}

import { describe, expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import { createTyrumHttpClient, TyrumHttpClientError, type TyrumHttpFetch } from "../src/index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function getHeader(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

function makeFetchMock(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
): TyrumHttpFetch {
  return vi.fn(impl) as unknown as TyrumHttpFetch;
}

function samplePairing(): Record<string, unknown> {
  const now = "2026-02-25T12:00:00.000Z";
  return {
    pairing_id: 7,
    status: "approved",
    trust_level: "local",
    requested_at: now,
    node: {
      node_id: "node-1",
      label: "Node 1",
      capabilities: ["http"],
      last_seen_at: now,
    },
    capability_allowlist: [{ id: "tyrum.http", version: "1.0.0" }],
    resolution: {
      decision: "approved",
      resolved_at: now,
      reason: "approved by operator",
    },
    resolved_at: now,
  };
}

function sampleAuthProfile(): Record<string, unknown> {
  return {
    profile_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    agent_id: "my-agent",
    provider: "openai",
    type: "api_key",
    secret_handles: {},
    labels: {},
    status: "active",
    created_at: "2026-02-25T00:00:00.000Z",
    updated_at: "2026-02-25T00:00:00.000Z",
  };
}

describe("createTyrumHttpClient", () => {
  it("exposes the expected admin/config API surface", () => {
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "test-token" },
      fetch: makeFetchMock(async () => jsonResponse({ status: "ok" })),
    });

    expect(typeof client.deviceTokens.issue).toBe("function");
    expect(typeof client.deviceTokens.revoke).toBe("function");
    expect(typeof client.secrets.store).toBe("function");
    expect(typeof client.secrets.list).toBe("function");
    expect(typeof client.secrets.revoke).toBe("function");
    expect(typeof client.secrets.rotate).toBe("function");
    expect(typeof client.policy.getBundle).toBe("function");
    expect(typeof client.policy.listOverrides).toBe("function");
    expect(typeof client.policy.createOverride).toBe("function");
    expect(typeof client.policy.revokeOverride).toBe("function");
    expect(typeof client.authProfiles.list).toBe("function");
    expect(typeof client.authProfiles.create).toBe("function");
    expect(typeof client.authProfiles.update).toBe("function");
    expect(typeof client.authProfiles.disable).toBe("function");
    expect(typeof client.authProfiles.enable).toBe("function");
    expect(typeof client.authPins.list).toBe("function");
    expect(typeof client.authPins.set).toBe("function");
    expect(typeof client.plugins.list).toBe("function");
    expect(typeof client.plugins.get).toBe("function");
    expect(typeof client.contracts.getCatalog).toBe("function");
    expect(typeof client.contracts.getSchema).toBe("function");
    expect(typeof client.models.status).toBe("function");
    expect(typeof client.models.refresh).toBe("function");
    expect(typeof client.models.listProviders).toBe("function");
    expect(typeof client.models.getProvider).toBe("function");
    expect(typeof client.models.listProviderModels).toBe("function");
    expect(typeof client.status.get).toBe("function");
    expect(typeof client.usage.get).toBe("function");
    expect(typeof client.presence.list).toBe("function");
    expect(typeof client.pairings.list).toBe("function");
    expect(typeof client.pairings.approve).toBe("function");
    expect(typeof client.pairings.deny).toBe("function");
    expect(typeof client.pairings.revoke).toBe("function");
  });

  it("sends bearer auth, normalizes baseUrl, and validates issue token responses", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse(
        {
          token_kind: "device",
          token: "tok_1",
          token_id: "tid_1",
          device_id: "device-1",
          role: "client",
          scopes: ["operator.read"],
          issued_at: "2026-02-25T12:00:00.000Z",
          expires_at: "2026-03-25T12:00:00.000Z",
        },
        201,
      ),
    );

    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example/",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const issued = await client.deviceTokens.issue({
      device_id: "device-1",
      role: "client",
      scopes: ["operator.read"],
      ttl_seconds: 120,
    });

    expect(issued.token_kind).toBe("device");
    expect(fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/auth/device-tokens/issue");
    expect(init.method).toBe("POST");
    expect(getHeader(init, "authorization")).toBe("Bearer root-token");
    expect(getHeader(init, "content-type")).toBe("application/json");
  });

  it("supports cookie auth strategy for browser/session workflows", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok", plugins: [] }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "cookie" },
      fetch,
    });

    await client.plugins.list();

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.credentials).toBe("include");
    expect(getHeader(init, "authorization")).toBeNull();
  });

  it("supports explicit none auth strategy", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok", plugins: [] }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "none" },
      fetch,
    });

    await client.plugins.list();

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(getHeader(init, "authorization")).toBeNull();
    expect(init.credentials).toBeUndefined();
  });

  it("validates requests before network calls", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok" }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    await expect(
      client.deviceTokens.issue({
        device_id: "",
        role: "client",
        scopes: [],
      }),
    ).rejects.toMatchObject<TyrumHttpClientError>({
      code: "request_invalid",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates responses and raises response_invalid on contract drift", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ handles: "not-an-array" }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    await expect(client.secrets.list()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "response_invalid",
    });
  });

  it("returns structured http_error for non-2xx responses", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({ error: "forbidden", message: "admin token required" }, 403),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "bad-token" },
      fetch,
    });

    await expect(client.plugins.list()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "http_error",
      status: 403,
      error: "forbidden",
    });
  });

  it("preserves server error context when response contains extra fields", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse(
        {
          error: "rate_limited",
          message: "too many requests, retry after 30s",
          request_id: "req-abc-123",
          details: { retry_after: 30 },
        },
        429,
      ),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "test-token" },
      fetch,
    });

    await expect(client.plugins.list()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "http_error",
      status: 429,
      error: "rate_limited",
      message: "too many requests, retry after 30s",
    });
  });

  it("maps fetch failures to network_error", async () => {
    const fetch = makeFetchMock(async () => {
      throw new Error("network down");
    });
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    await expect(client.plugins.list()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "network_error",
    });
  });

  it("supports query params for scoped list endpoints", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ handles: [] }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    await client.secrets.list({ agent_id: "agent-1" });

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("https://gateway.example/secrets?agent_id=agent-1");
  });

  it("rejects invalid usage scope combinations locally", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok" }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    await expect(
      client.usage.get({ run_id: "r1", key: "k1" }),
    ).rejects.toMatchObject<TyrumHttpClientError>({
      code: "request_invalid",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates pairing mutate responses against NodePairingRequest", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({ status: "ok", pairing: samplePairing() }),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const approved = await client.pairings.approve(7, {
      trust_level: "local",
      capability_allowlist: [{ id: "tyrum.http", version: "1.0.0" }],
      reason: "allow",
    });
    expect(approved.pairing.status).toBe("approved");
  });

  it("validates contracts schema filename input", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ type: "object" }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    await expect(
      client.contracts.getSchema("../secrets.json"),
    ).rejects.toMatchObject<TyrumHttpClientError>({
      code: "request_invalid",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  // --- AbortSignal support ---

  it("passes per-request signal to fetch", async () => {
    const controller = new AbortController();
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok", plugins: [] }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "tok" },
      fetch,
    });

    await client.plugins.list({ signal: controller.signal });

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.signal).toBe(controller.signal);
  });

  it("uses global signal as default when per-request signal is absent", async () => {
    const controller = new AbortController();
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok", plugins: [] }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "tok" },
      fetch,
      signal: controller.signal,
    });

    await client.plugins.list();

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.signal).toBe(controller.signal);
  });

  it("per-request signal overrides global signal", async () => {
    const globalController = new AbortController();
    const localController = new AbortController();
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok", plugins: [] }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "tok" },
      fetch,
      signal: globalController.signal,
    });

    await client.plugins.list({ signal: localController.signal });

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.signal).toBe(localController.signal);
  });

  it("aborted signal produces network_error", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = makeFetchMock(async (_input, init) => {
      if (init?.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
      return jsonResponse({ status: "ok", plugins: [] });
    });
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "tok" },
      fetch,
    });

    await expect(
      client.plugins.list({ signal: controller.signal }),
    ).rejects.toMatchObject<TyrumHttpClientError>({
      code: "network_error",
    });
  });

  // --- Auth profile CRUD ---

  it("authProfiles.create sends POST /auth/profiles and expects 201", async () => {
    const profile = sampleAuthProfile();
    const fetch = makeFetchMock(async () => jsonResponse({ profile }, 201));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const result = await client.authProfiles.create({
      provider: "openai",
      secret_handles: { api_key: "handle-1" },
    });
    expect(result.profile.provider).toBe("openai");

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
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

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
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

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
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

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
    const fetch = makeFetchMock(async () => jsonResponse({ pins: [] }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    await client.authPins.list({ agent_id: "agent-1", provider: "openai" });

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("https://gateway.example/auth/pins?agent_id=agent-1&provider=openai");
  });

  it("authPins.set branches on profile_id null (clear) vs set (201)", async () => {
    const pin = {
      agent_id: "my-agent",
      session_id: "sess-1",
      provider: "openai",
      profile_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      pinned_at: "2026-02-25T00:00:00.000Z",
      updated_at: "2026-02-25T00:00:00.000Z",
    };

    const fetchSet = makeFetchMock(async () => jsonResponse({ status: "ok", pin }, 201));
    const clientSet = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch: fetchSet,
    });

    const setResult = await clientSet.authPins.set({
      session_id: "sess-1",
      provider: "openai",
      profile_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    });
    expect(setResult.status).toBe("ok");
    expect("pin" in setResult).toBe(true);

    const fetchClear = makeFetchMock(async () => jsonResponse({ status: "ok", cleared: true }));
    const clientClear = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch: fetchClear,
    });

    const clearResult = await clientClear.authPins.set({
      session_id: "sess-1",
      provider: "openai",
      profile_id: null,
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
            handle_id: "handle-1",
            provider: "env",
            scope: "my-scope",
            created_at: "2026-02-25T00:00:00.000Z",
          },
        },
        201,
      ),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const result = await client.secrets.store({ scope: "my-scope", value: "s3cret" });
    expect(result.handle.handle_id).toBe("handle-1");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/secrets");
    expect(init.method).toBe("POST");
  });

  it("secrets.revoke sends DELETE /secrets/:id with query", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ revoked: true }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const result = await client.secrets.revoke("secret-1", { agent_id: "agent-1" });
    expect(result.revoked).toBe(true);

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/secrets/secret-1?agent_id=agent-1");
    expect(init.method).toBe("DELETE");
  });

  it("secrets.rotate sends POST /secrets/:id/rotate and expects 201", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse(
        {
          revoked: true,
          handle: {
            handle_id: "handle-2",
            provider: "env",
            scope: "my-scope",
            created_at: "2026-02-25T00:00:00.000Z",
          },
        },
        201,
      ),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const result = await client.secrets.rotate("secret-1", { value: "new-s3cret" });
    expect(result.handle.handle_id).toBe("handle-2");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/secrets/secret-1/rotate");
    expect(init.method).toBe("POST");
  });

  // --- Policy ---

  it("policy.getBundle sends GET /policy/bundle and validates nested response", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        status: "ok",
        generated_at: "2026-02-25T00:00:00.000Z",
        effective: {
          sha256: "a".repeat(64),
          bundle: { v: 1 },
          sources: {
            deployment: "prod",
            agent: null,
            playbook: null,
          },
        },
      }),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const result = await client.policy.getBundle();
    expect(result.status).toBe("ok");
    expect(result.effective.bundle.v).toBe(1);
  });

  it("policy.createOverride sends POST /policy/overrides and expects 201", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse(
        {
          override: {
            policy_override_id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
            status: "active",
            created_at: "2026-02-25T00:00:00.000Z",
            agent_id: "my-agent",
            tool_id: "bash",
            pattern: "*",
          },
        },
        201,
      ),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const result = await client.policy.createOverride({
      agent_id: "my-agent",
      tool_id: "bash",
      pattern: "*",
    });
    expect(result.override.status).toBe("active");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/policy/overrides");
    expect(init.method).toBe("POST");
  });

  it("policy.revokeOverride sends POST /policy/overrides/revoke", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        override: {
          policy_override_id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
          status: "revoked",
          created_at: "2026-02-25T00:00:00.000Z",
          agent_id: "my-agent",
          tool_id: "bash",
          pattern: "*",
        },
      }),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const result = await client.policy.revokeOverride({
      policy_override_id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
    });
    expect(result.override.status).toBe("revoked");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/policy/overrides/revoke");
    expect(init.method).toBe("POST");
  });

  // --- Models ---

  it("models.status sends GET /models/status", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok", models_dev: null }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const result = await client.models.status();
    expect(result.status).toBe("ok");

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("https://gateway.example/models/status");
  });

  it("models.listProviders sends GET /models/providers and validates provider summary", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        status: "ok",
        models_dev: null,
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            npm: "@ai-sdk/openai",
            api: "https://api.openai.com",
            env: ["OPENAI_API_KEY"],
            doc: "https://openai.com/docs",
            model_count: 42,
          },
        ],
      }),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const result = await client.models.listProviders();
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].id).toBe("openai");
  });

  it("models.getProvider sends GET /models/providers/:id with encoded path", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        status: "ok",
        models_dev: null,
        provider: {
          id: "open/ai",
          name: "OpenAI",
          env: ["OPENAI_API_KEY"],
          models: {},
        },
      }),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    await client.models.getProvider("open/ai");

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("https://gateway.example/models/providers/open%2Fai");
  });

  // --- Observability ---

  it("status.get sends GET /status and validates StatusResponse fields", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        status: "ok",
        version: "1.0.0",
        instance_id: "inst-1",
        role: "gateway",
        db_kind: "sqlite",
        is_exposed: false,
        otel_enabled: true,
        ws: null,
        policy: null,
        model_auth: null,
        catalog_freshness: null,
        session_lanes: null,
        queue_depth: null,
        sandbox: null,
      }),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const result = await client.status.get();
    expect(result.status).toBe("ok");
    expect(result.version).toBe("1.0.0");
    expect(result.role).toBe("gateway");
  });

  it("presence.list sends GET /presence", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        status: "ok",
        generated_at: "2026-02-25T00:00:00.000Z",
        entries: [],
      }),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    const result = await client.presence.list();
    expect(result.entries).toEqual([]);

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("https://gateway.example/presence");
  });

  it("pairings.deny sends POST /pairings/:id/deny with optional body", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({ status: "ok", pairing: samplePairing() }),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    await client.pairings.deny(7, { reason: "not trusted" });

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/pairings/7/deny");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "not trusted" });
  });

  // --- Edge cases ---

  it("204 response with empty body returns undefined through readJsonBody", async () => {
    const fetch = makeFetchMock(async () => new Response(null, { status: 204 }));
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    await expect(client.plugins.list()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "response_invalid",
    });
  });

  it("non-JSON success body produces response_invalid with clear message", async () => {
    const fetch = makeFetchMock(
      async () =>
        new Response("this is not json", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    const client = createTyrumHttpClient({
      baseUrl: "https://gateway.example",
      auth: { type: "bearer", token: "root-token" },
      fetch,
    });

    await expect(client.plugins.list()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "response_invalid",
      message: "response body is not valid JSON",
    });
  });
});

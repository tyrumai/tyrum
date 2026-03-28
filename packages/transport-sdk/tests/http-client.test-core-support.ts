import { expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import { TyrumHttpClientError } from "../src/index.js";
import {
  createTestClient,
  expectApiSurface,
  getHeader,
  jsonResponse,
  makeFetchMock,
  mockJsonFetch,
  samplePairing,
} from "./http-client.test-support.js";

export function registerHttpClientCoreTests(): void {
  it("exposes the expected admin/config API surface", () => {
    const client = createTestClient({
      auth: { type: "bearer", token: "test-token" },
      fetch: mockJsonFetch({ status: "ok" }),
    });

    expectApiSurface(client);
  });

  it("requests agent list and validates response", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        agents: [
          {
            agent_key: "default",
            agent_id: "11111111-1111-4111-8111-111111111111",
            persona: {
              name: "Hypatia",
              tone: "direct",
              palette: "graphite",
              character: "architect",
            },
          },
          {
            agent_key: "agent-1",
            agent_id: "22222222-2222-4222-8222-222222222222",
            home: "/tmp/agent-1",
            persona: {
              name: "Ada",
              tone: "direct",
              palette: "moss",
              character: "builder",
            },
          },
        ],
      }),
    );

    const client = createTestClient({ fetch });

    const res = await client.agentList.get({ include_default: false });

    expect(res.agents.map((a) => a.agent_key)).toEqual(["default", "agent-1"]);
    expect(res.agents[0]?.persona.name).toBe("Hypatia");
    expect(res.agents[1]?.agent_id).toBe("22222222-2222-4222-8222-222222222222");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/agent/list?include_default=false");
    expect(init.method).toBe("GET");
    expect(getHeader(init, "authorization")).toBe("Bearer root-token");
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

    const client = createTestClient({ baseUrl: "https://gateway.example/", fetch });

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

  it("parses persistent device token responses with null expires_at", async () => {
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
          expires_at: null,
        },
        201,
      ),
    );

    const client = createTestClient({ baseUrl: "https://gateway.example/", fetch });

    const issued = await client.deviceTokens.issue({
      device_id: "device-1",
      role: "client",
      scopes: ["operator.read"],
      persistent: true,
    });

    expect(issued.expires_at).toBeNull();
  });

  it("supports cookie auth strategy for browser/conversation workflows", async () => {
    const fetch = mockJsonFetch({ status: "ok", plugins: [] });
    const client = createTestClient({ auth: { type: "cookie" }, fetch });

    await client.plugins.list();

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.credentials).toBe("include");
    expect(getHeader(init, "authorization")).toBeNull();
  });

  it("wraps the global fetch so browser-native invocation stays valid", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async function (this: unknown) {
      if (this && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return jsonResponse({ status: "ok", plugins: [] });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const client = createTestClient();

      await expect(client.plugins.list()).resolves.toEqual({ status: "ok", plugins: [] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("supports explicit none auth strategy", async () => {
    const fetch = mockJsonFetch({ status: "ok", plugins: [] });
    const client = createTestClient({ auth: { type: "none" }, fetch });

    await client.plugins.list();

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(getHeader(init, "authorization")).toBeNull();
    expect(init.credentials).toBeUndefined();
  });

  it("lists configured providers and validates the response", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        status: "ok",
        providers: [
          {
            provider_key: "openai",
            name: "OpenAI",
            doc: "https://platform.openai.com/docs",
            supported: true,
            accounts: [
              {
                account_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
                account_key: "openai-primary",
                provider_key: "openai",
                display_name: "Primary OpenAI",
                method_key: "api_key",
                type: "api_key",
                status: "active",
                config: {},
                configured_secret_keys: ["api_key"],
                created_at: "2026-02-25T00:00:00.000Z",
                updated_at: "2026-02-25T00:00:00.000Z",
              },
            ],
          },
        ],
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.providerConfig.listProviders();

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.provider_key).toBe("openai");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/config/providers");
    expect(init.method).toBe("GET");
  });

  it("returns structured delete-preset conflicts for replacement-required flows", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse(
        {
          error: "assignment_required",
          message: "replacement preset assignments are required before deleting this preset",
          required_execution_profile_ids: ["interaction", "planner"],
        },
        409,
      ),
    );
    const client = createTestClient({ fetch });

    const result = await client.modelConfig.deletePreset("interaction-default");

    expect(result).toEqual({
      error: "assignment_required",
      message: "replacement preset assignments are required before deleting this preset",
      required_execution_profile_ids: ["interaction", "planner"],
    });

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/config/models/presets/interaction-default");
    expect(init.method).toBe("DELETE");
  });

  it("returns structured delete-provider conflicts for replacement-required flows", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse(
        {
          error: "assignment_required",
          message: "replacement preset assignments are required before deleting this provider",
          required_execution_profile_ids: ["interaction", "planner"],
        },
        409,
      ),
    );
    const client = createTestClient({ fetch });

    const result = await client.providerConfig.deleteProvider("openai");

    expect(result).toEqual({
      error: "assignment_required",
      message: "replacement preset assignments are required before deleting this provider",
      required_execution_profile_ids: ["interaction", "planner"],
    });

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/config/providers/openai");
    expect(init.method).toBe("DELETE");
  });

  it("validates requests before network calls", async () => {
    const fetch = mockJsonFetch({ status: "ok" });
    const client = createTestClient({ fetch });

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
    const client = createTestClient({ fetch });

    await expect(client.secrets.list()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "response_invalid",
    });
  });

  it("returns structured http_error for non-2xx responses", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({ error: "forbidden", message: "admin token required" }, 403),
    );
    const client = createTestClient({ auth: { type: "bearer", token: "bad-token" }, fetch });

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
    const client = createTestClient({ auth: { type: "bearer", token: "test-token" }, fetch });

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
    const client = createTestClient({ fetch });

    await expect(client.plugins.list()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "network_error",
    });
  });

  it("supports query params for scoped list endpoints", async () => {
    const fetch = mockJsonFetch({ handles: [] });
    const client = createTestClient({ fetch });

    await client.secrets.list({ agent_key: "agent-1" });

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("https://gateway.example/secrets?agent_key=agent-1");
  });

  it("rejects invalid usage scope combinations locally", async () => {
    const fetch = mockJsonFetch({ status: "ok" });
    const client = createTestClient({ fetch });

    await expect(
      client.usage.get({ turn_id: "r1", key: "k1" }),
    ).rejects.toMatchObject<TyrumHttpClientError>({
      code: "request_invalid",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates pairing mutate responses against NodePairingRequest", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({ status: "ok", pairing: samplePairing() }),
    );
    const client = createTestClient({ fetch });

    const approved = await client.pairings.approve(7, {
      trust_level: "local",
      capability_allowlist: [{ id: "tyrum.http", version: "1.0.0" }],
      reason: "allow",
    });
    expect(approved.pairing.status).toBe("approved");
  });

  it("validates contracts schema filename input", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ type: "object" }));
    const client = createTestClient({ fetch });

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
    const fetch = mockJsonFetch({ status: "ok", plugins: [] });
    const client = createTestClient({ auth: { type: "bearer", token: "tok" }, fetch });

    await client.plugins.list({ signal: controller.signal });

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.signal).toBe(controller.signal);
  });

  it("uses global signal as default when per-request signal is absent", async () => {
    const controller = new AbortController();
    const fetch = mockJsonFetch({ status: "ok", plugins: [] });
    const client = createTestClient({
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
    const fetch = mockJsonFetch({ status: "ok", plugins: [] });
    const client = createTestClient({
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
    const client = createTestClient({ auth: { type: "bearer", token: "tok" }, fetch });

    await expect(
      client.plugins.list({ signal: controller.signal }),
    ).rejects.toMatchObject<TyrumHttpClientError>({
      code: "network_error",
    });
  });

  // --- Auth profile CRUD ---
}

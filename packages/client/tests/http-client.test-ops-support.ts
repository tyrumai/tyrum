import { expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import { TyrumHttpClientError } from "../src/index.js";
import {
  createTestClient,
  jsonResponse,
  makeFetchMock,
  mockJsonFetch,
  samplePairing,
} from "./http-client.test-support.js";

export function registerHttpClientOpsTests(): void {
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
    const client = createTestClient({ fetch });

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
            agent_id: "00000000-0000-4000-8000-000000000002",
            tool_id: "bash",
            pattern: "*",
          },
        },
        201,
      ),
    );
    const client = createTestClient({ fetch });

    const result = await client.policy.createOverride({
      agent_id: "00000000-0000-4000-8000-000000000002",
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
          agent_id: "00000000-0000-4000-8000-000000000002",
          tool_id: "bash",
          pattern: "*",
        },
      }),
    );
    const client = createTestClient({ fetch });

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
    const fetch = mockJsonFetch({ status: "ok", models_dev: null });
    const client = createTestClient({ fetch });

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
    const client = createTestClient({ fetch });

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
    const client = createTestClient({ fetch });

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
    const client = createTestClient({ fetch });

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
    const client = createTestClient({ fetch });

    const result = await client.presence.list();
    expect(result.entries).toEqual([]);

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("https://gateway.example/presence");
  });

  it("pairings.deny sends POST /pairings/:id/deny with optional body", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({ status: "ok", pairing: samplePairing() }),
    );
    const client = createTestClient({ fetch });

    await client.pairings.deny(7, { reason: "not trusted" });

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/pairings/7/deny");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "not trusted" });
  });

  // --- Operator/admin surfaces ---

  it("health.get sends GET /healthz and validates response", async () => {
    const fetch = mockJsonFetch({ status: "ok", is_exposed: false });
    const client = createTestClient({ fetch });

    const admin = client as unknown as Record<string, any>;
    expect(typeof admin.health?.get).toBe("function");

    const result = await admin.health.get();
    expect(result.status).toBe("ok");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/healthz");
    expect(init.method).toBe("GET");
  });

  it("artifacts.getBytes returns redirect for 302 responses", async () => {
    const fetch = makeFetchMock(async (_input, init) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://signed.example/artifact.bin" },
      });
    });

    const client = createTestClient({ fetch });

    const admin = client as unknown as Record<string, any>;
    expect(typeof admin.artifacts?.getBytes).toBe("function");

    const result = await admin.artifacts.getBytes(
      "550e8400-e29b-41d4-a716-446655440001",
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(result).toEqual({ kind: "redirect", url: "https://signed.example/artifact.bin" });
  });

  it("artifacts.getBytes returns bytes for 200 responses", async () => {
    const fetch = makeFetchMock(async (_input, init) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    });

    const client = createTestClient({ fetch });

    const admin = client as unknown as Record<string, any>;
    expect(typeof admin.artifacts?.getBytes).toBe("function");

    const result = await admin.artifacts.getBytes(
      "550e8400-e29b-41d4-a716-446655440001",
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(result.kind).toBe("bytes");
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.contentType).toBe("application/octet-stream");
  });

  it("artifacts.getBytes returns gateway URL for opaque redirects (browser-safe)", async () => {
    const runId = "550e8400-e29b-41d4-a716-446655440001";
    const artifactId = "550e8400-e29b-41d4-a716-446655440000";

    const fetch = makeFetchMock(async (input, init) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      expect(String(input)).toBe(`https://gateway.example/runs/${runId}/artifacts/${artifactId}`);

      const response = new Response(null, { status: 302 });
      Object.defineProperty(response, "type", { value: "opaqueredirect" });
      return response;
    });

    const client = createTestClient({ fetch });

    const admin = client as unknown as Record<string, any>;
    expect(typeof admin.artifacts?.getBytes).toBe("function");

    const result = await admin.artifacts.getBytes(runId, artifactId);
    expect(result).toEqual({
      kind: "redirect",
      url: `https://gateway.example/runs/${runId}/artifacts/${artifactId}`,
    });
  });

  it("audit.verify rejects non-string action entries before network call", async () => {
    const fetch = mockJsonFetch({ valid: true });
    const client = createTestClient({ fetch });

    const admin = client as unknown as Record<string, any>;
    expect(typeof admin.audit?.verify).toBe("function");

    await expect(
      admin.audit.verify({
        events: [
          {
            id: 1,
            plan_id: "plan-1",
            step_index: 0,
            occurred_at: "2026-02-25T00:00:00.000Z",
            action: { type: "not-a-string" },
            prev_hash: null,
            event_hash: null,
          },
        ],
      }),
    ).rejects.toMatchObject<TyrumHttpClientError>({
      code: "request_invalid",
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  // --- Edge cases ---

  it("204 response with empty body returns undefined through readJsonBody", async () => {
    const fetch = makeFetchMock(async () => new Response(null, { status: 204 }));
    const client = createTestClient({ fetch });

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
    const client = createTestClient({ fetch });

    await expect(client.plugins.list()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "response_invalid",
      message: "response body is not valid JSON",
    });
  });
}

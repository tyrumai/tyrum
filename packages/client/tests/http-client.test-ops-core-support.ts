import { expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import {
  createTestClient,
  jsonResponse,
  makeFetchMock,
  mockJsonFetch,
  samplePairing,
} from "./http-client.test-support.js";

export function registerHttpClientOpsCoreTests(): void {
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
        auth: { enabled: true },
        ws: null,
        policy: null,
        model_auth: null,
        catalog_freshness: null,
        session_lanes: null,
        queue_depth: null,
        sandbox: null,
        config_health: { status: "ok", issues: [] },
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

  it("pairings.get sends GET /pairings/:id", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({ status: "ok", pairing: samplePairing() }),
    );
    const client = createTestClient({ fetch });

    await client.pairings.get(7);

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/pairings/7");
    expect(init.method).toBe("GET");
  });
}

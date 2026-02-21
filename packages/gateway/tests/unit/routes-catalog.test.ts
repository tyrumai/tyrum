import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createCatalogRoutes } from "../../src/routes/catalog.js";

function makeProvider(id: string, models: Record<string, unknown> = {}) {
  return { id, name: `Provider ${id}`, models };
}

const sampleQuota = {
  model_id: "gpt-4",
  requests_remaining: 100,
  tokens_remaining: 50000,
  reset_at: "2026-02-01T00:00:00Z",
};

const sampleModel = {
  id: "gpt-4",
  provider: "openai",
  name: "GPT-4",
  context_window: 128000,
};

describe("catalog routes", () => {
  function buildCatalog(overrides: Record<string, unknown> = {}) {
    const mockCatalog = {
      isLoaded: true,
      isStale: false,
      refresh: vi.fn(async () => {}),
      getEnabledProviders: vi.fn(() => [
        makeProvider("openai", { "gpt-4": {}, "gpt-3.5": {} }),
        makeProvider("anthropic", { "claude-3": {} }),
      ]),
      listProviders: vi.fn(() => [
        makeProvider("openai"),
        makeProvider("anthropic"),
        makeProvider("local"),
      ]),
      getModel: vi.fn((id: string) =>
        id === "gpt-4" ? sampleModel : undefined,
      ),
      getQuotaInfo: vi.fn((id: string) =>
        id === "gpt-4" ? sampleQuota : undefined,
      ),
      ...overrides,
    };
    const app = new Hono();
    app.route("/", createCatalogRoutes({ modelCatalog: mockCatalog }));
    return { app, mockCatalog };
  }

  // ── GET /models/catalog ────────────────────────────────────

  it("GET /models/catalog triggers refresh when not loaded", async () => {
    const { app, mockCatalog } = buildCatalog({ isLoaded: false });
    const res = await app.request("/models/catalog");
    expect(res.status).toBe(200);
    expect(mockCatalog.refresh).toHaveBeenCalled();

    const body = (await res.json()) as {
      providers: { id: string; model_count: number }[];
      total_providers: number;
      enabled_providers: number;
    };
    expect(body.providers).toHaveLength(2);
    expect(body.providers[0]).toMatchObject({ id: "openai", model_count: 2 });
    expect(body.total_providers).toBe(3);
    expect(body.enabled_providers).toBe(2);
  });

  it("GET /models/catalog uses cache when loaded and not stale", async () => {
    const { app, mockCatalog } = buildCatalog();
    const res = await app.request("/models/catalog");
    expect(res.status).toBe(200);
    expect(mockCatalog.refresh).not.toHaveBeenCalled();
  });

  // ── GET /models/catalog/:modelId ───────────────────────────

  it("GET /models/catalog/:modelId returns model info", async () => {
    const { app } = buildCatalog();
    const res = await app.request("/models/catalog/gpt-4");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("gpt-4");
  });

  it("GET /models/catalog/:modelId returns 404 when not found", async () => {
    const { app } = buildCatalog();
    const res = await app.request("/models/catalog/unknown-model");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  // ── GET /models/catalog/:modelId/quota ─────────────────────

  it("GET /models/catalog/:modelId/quota returns quota", async () => {
    const { app } = buildCatalog();
    const res = await app.request("/models/catalog/gpt-4/quota");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requests_remaining: number };
    expect(body.requests_remaining).toBe(100);
  });

  it("GET /models/catalog/:modelId/quota returns 404 when no quota", async () => {
    const { app } = buildCatalog();
    const res = await app.request("/models/catalog/unknown-model/quota");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});

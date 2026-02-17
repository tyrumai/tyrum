import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadModelGatewayConfig,
  createModelProxyRoutesFromState,
} from "../../src/routes/model-proxy.js";

describe("loadModelGatewayConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "model-proxy-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a minimal config with one model and no auth", () => {
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
models:
  gpt-4:
    target: openai
    endpoint: https://api.openai.com/v1
`,
    );

    const state = loadModelGatewayConfig(configPath);
    expect(state.routes.size).toBe(1);
    expect(state.routes.has("gpt-4")).toBe(true);

    const route = state.routes.get("gpt-4")!;
    expect(route.target).toBe("openai");
    expect(route.auth).toEqual({ kind: "none" });
    expect(route.capabilities).toEqual([]);
    expect(state.timeoutMs).toBe(20_000);
  });

  it("resolves bearer auth from env", () => {
    process.env["TEST_MODEL_PROXY_KEY"] = "sk-test-123";
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
auth_profiles:
  openai:
    type: bearer
    env: TEST_MODEL_PROXY_KEY
models:
  gpt-4:
    target: openai
    endpoint: https://api.openai.com/v1
    auth_profile: openai
`,
    );

    const state = loadModelGatewayConfig(configPath);
    const route = state.routes.get("gpt-4")!;
    expect(route.auth).toEqual({ kind: "bearer", token: "sk-test-123" });

    delete process.env["TEST_MODEL_PROXY_KEY"];
  });

  it("throws on bearer auth with missing env field", () => {
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
auth_profiles:
  openai:
    type: bearer
models:
  gpt-4:
    target: openai
    endpoint: https://api.openai.com/v1
    auth_profile: openai
`,
    );

    expect(() => loadModelGatewayConfig(configPath)).toThrow(
      "bearer auth requires 'env' field",
    );
  });

  it("throws on bearer auth with empty env var", () => {
    process.env["TEST_EMPTY_KEY"] = "   ";
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
auth_profiles:
  openai:
    type: bearer
    env: TEST_EMPTY_KEY
models:
  gpt-4:
    target: openai
    endpoint: https://api.openai.com/v1
    auth_profile: openai
`,
    );

    expect(() => loadModelGatewayConfig(configPath)).toThrow(
      "empty or missing",
    );

    delete process.env["TEST_EMPTY_KEY"];
  });

  it("throws on bearer auth with missing env var", () => {
    delete process.env["NONEXISTENT_KEY_12345"];
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
auth_profiles:
  openai:
    type: bearer
    env: NONEXISTENT_KEY_12345
models:
  gpt-4:
    target: openai
    endpoint: https://api.openai.com/v1
    auth_profile: openai
`,
    );

    expect(() => loadModelGatewayConfig(configPath)).toThrow(
      "empty or missing",
    );
  });

  it("resolves static_header auth", () => {
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
auth_profiles:
  custom:
    type: static_header
    header: X-Api-Key
    value: my-secret
models:
  claude:
    target: anthropic
    endpoint: https://api.anthropic.com
    auth_profile: custom
`,
    );

    const state = loadModelGatewayConfig(configPath);
    const route = state.routes.get("claude")!;
    expect(route.auth).toEqual({
      kind: "static",
      header: "X-Api-Key",
      value: "my-secret",
    });
  });

  it("throws on static_header auth with missing fields", () => {
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
auth_profiles:
  custom:
    type: static_header
    header: X-Api-Key
models:
  gpt-4:
    target: openai
    endpoint: https://api.openai.com/v1
    auth_profile: custom
`,
    );

    expect(() => loadModelGatewayConfig(configPath)).toThrow(
      "static_header auth requires 'header' and 'value'",
    );
  });

  it("defaults unknown auth type to none", () => {
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
auth_profiles:
  weird:
    type: oauth2
models:
  gpt-4:
    target: openai
    endpoint: https://api.openai.com/v1
    auth_profile: weird
`,
    );

    const state = loadModelGatewayConfig(configPath);
    const route = state.routes.get("gpt-4")!;
    expect(route.auth).toEqual({ kind: "none" });
  });

  it("throws on empty config file", () => {
    const configPath = join(dir, "config.yaml");
    writeFileSync(configPath, "   ");

    expect(() => loadModelGatewayConfig(configPath)).toThrow("empty");
  });

  it("throws on config with no models", () => {
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
defaults:
  timeout_ms: 5000
`,
    );

    expect(() => loadModelGatewayConfig(configPath)).toThrow("no models");
  });

  it("falls back to none when auth_profile references nonexistent profile", () => {
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
models:
  gpt-4:
    target: openai
    endpoint: https://api.openai.com/v1
    auth_profile: nonexistent
`,
    );

    const state = loadModelGatewayConfig(configPath);
    const route = state.routes.get("gpt-4")!;
    expect(route.auth).toEqual({ kind: "none" });
  });

  it("respects custom timeout", () => {
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
defaults:
  timeout_ms: 5000
models:
  gpt-4:
    target: openai
    endpoint: https://api.openai.com/v1
`,
    );

    const state = loadModelGatewayConfig(configPath);
    expect(state.timeoutMs).toBe(5000);
  });

  it("parses capabilities and token limits", () => {
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
models:
  gpt-4:
    target: openai
    endpoint: https://api.openai.com/v1
    capabilities:
      - chat
      - embeddings
    max_total_tokens: 128000
    cost_ceiling_usd: 5.0
`,
    );

    const state = loadModelGatewayConfig(configPath);
    const route = state.routes.get("gpt-4")!;
    expect(route.capabilities).toEqual(["chat", "embeddings"]);
    expect(route.maxTotalTokens).toBe(128000);
    expect(route.costCeilingUsd).toBe(5.0);
  });

  it("config with no auth_profiles key does not error", () => {
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `
models:
  gpt-4:
    target: openai
    endpoint: https://api.openai.com/v1
`,
    );

    const state = loadModelGatewayConfig(configPath);
    expect(state.routes.size).toBe(1);
  });
});

describe("createModelProxyRoutesFromState", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeState(
    overrides: Partial<{
      auth: { kind: "none" } | { kind: "bearer"; token: string } | { kind: "static"; header: string; value: string };
      timeoutMs: number;
    }> = {},
  ) {
    const routes = new Map();
    routes.set("test-model", {
      target: "test",
      baseUrl: "https://upstream.example.com/v1/",
      auth: overrides.auth ?? { kind: "none" },
      capabilities: ["chat"],
      maxTotalTokens: 4096,
    });
    return {
      routes,
      timeoutMs: overrides.timeoutMs ?? 20_000,
    };
  }

  it("GET /v1/models lists configured models", async () => {
    const app = createModelProxyRoutesFromState(makeState());
    const res = await app.request("/v1/models");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; models: unknown[] };
    expect(body.status).toBe("ok");
    expect(body.models).toHaveLength(1);
  });

  it("returns 400 for invalid JSON body", async () => {
    const app = createModelProxyRoutesFromState(makeState());
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: "not-json{{{",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("invalid JSON");
  });

  it("returns 400 for missing model field", async () => {
    const app = createModelProxyRoutesFromState(makeState());
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("model");
  });

  it("returns 404 for unconfigured model", async () => {
    const app = createModelProxyRoutesFromState(makeState());
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "unknown-model" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not configured");
  });

  it("proxies request with no auth", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const app = createModelProxyRoutesFromState(makeState());
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "test-model", messages: [] }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = fetchCall[1].headers as Headers;
    expect(headers.has("authorization")).toBe(false);
  });

  it("proxies request with bearer auth", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const app = createModelProxyRoutesFromState(
      makeState({ auth: { kind: "bearer", token: "sk-secret" } }),
    );
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "test-model", messages: [] }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer sk-secret");
  });

  it("proxies request with static header auth", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const app = createModelProxyRoutesFromState(
      makeState({
        auth: { kind: "static", header: "X-Api-Key", value: "my-key" },
      }),
    );
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "test-model", messages: [] }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get("x-api-key")).toBe("my-key");
  });

  it("returns 502 when upstream fetch throws", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const app = createModelProxyRoutesFromState(makeState());
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "test-model", messages: [] }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("ECONNREFUSED");
  });

  it("streams response when stream is true", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn(async () =>
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    ) as unknown as typeof fetch;

    const app = createModelProxyRoutesFromState(makeState());
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "test-model",
        messages: [],
        stream: true,
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("data:");
  });

  it("buffers response when not streaming", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: "resp-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const app = createModelProxyRoutesFromState(makeState());
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "test-model", messages: [] }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("resp-1");
  });

  it("strips hop-by-hop headers from request", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const app = createModelProxyRoutesFromState(makeState());
    await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "test-model" }),
      headers: {
        "Content-Type": "application/json",
        Connection: "keep-alive",
        "Transfer-Encoding": "chunked",
      },
    });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = fetchCall[1].headers as Headers;
    expect(headers.has("connection")).toBe(false);
    expect(headers.has("transfer-encoding")).toBe(false);
  });

  it("strips client authorization header (uses route auth instead)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const app = createModelProxyRoutesFromState(
      makeState({ auth: { kind: "bearer", token: "route-token" } }),
    );
    await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "test-model" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer client-token",
      },
    });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer route-token");
  });

  it("works for /v1/embeddings endpoint", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const app = createModelProxyRoutesFromState(makeState());
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      body: JSON.stringify({ model: "test-model", input: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
  });
});

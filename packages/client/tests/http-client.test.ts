import { describe, expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import {
  createTyrumHttpClient,
  TyrumHttpClientError,
  type TyrumHttpFetch,
} from "../src/index.js";

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

    await expect(client.usage.get({ run_id: "r1", key: "k1" })).rejects.toMatchObject<
      TyrumHttpClientError
    >({
      code: "request_invalid",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates pairing mutate responses against NodePairingRequest", async () => {
    const fetch = makeFetchMock(async () => jsonResponse({ status: "ok", pairing: samplePairing() }));
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

    await expect(client.contracts.getSchema("../secrets.json")).rejects.toMatchObject<
      TyrumHttpClientError
    >({
      code: "request_invalid",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
